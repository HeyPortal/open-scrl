#include <CoreImage/CoreImage.h>
using namespace metal;

float3 seamLinear(float3 s) {
    return select(pow((s + 0.055f) / 1.055f, float3(2.4f)), s / 12.92f, s <= 0.04045f);
}
float3 seamEncoded(float3 s) {
    return select(1.055f * pow(s, float3(1.0f / 2.4f)) - 0.055f, s * 12.92f, s <= 0.0031308f);
}

// Small compositing kernels let decoded pixel buffers remain GPU inputs throughout
// cropping, masks, shadow creation and final scene placement.
[[stitchable]] float4 sceneOpacity(coreimage::sample_t pixel, float opacity, float4 bounds,
                                  coreimage::destination destination) {
    float2 coord = destination.coord();
    if (any(coord < bounds.xy) || any(coord >= bounds.xy + bounds.zw)) return float4(0.0f);
    return pixel * opacity;
}

[[stitchable]] float4 sceneTint(coreimage::sample_t pixel, float4 color, float4 bounds,
                               coreimage::destination destination) {
    float2 coord = destination.coord();
    if (any(coord < bounds.xy) || any(coord >= bounds.xy + bounds.zw)) return float4(0.0f);
    float alpha = pixel.a * color.a;
    return float4(color.rgb * alpha, alpha);
}

[[stitchable]] float4 sceneMask(coreimage::sampler source, coreimage::sampler mask, float4 bounds,
                               coreimage::destination destination) {
    float2 coord = destination.coord();
    if (any(coord < bounds.xy) || any(coord >= bounds.xy + bounds.zw)) return float4(0.0f);
    return source.sample(source.transform(coord)) * mask.sample(mask.transform(coord)).a;
}

[[stitchable]] float4 sceneChecker(float4 geometry, float cell, coreimage::destination destination) {
    float2 coord = destination.coord() - geometry.xy;
    if (any(coord < float2(0.0f)) || any(coord >= geometry.zw)) return float4(0.0f);
    float row = floor((geometry.w - coord.y) / cell);
    float col = floor(coord.x / cell);
    bool gray = fmod(row + col, 2.0f) < 1.0f;
    return gray ? float4(0.894f, 0.894f, 0.906f, 1.0f) : float4(1.0f);
}

[[stitchable]] float4 sceneOutline(float4 geometry, float4 settings, float4 color,
                                  coreimage::destination destination) {
    float2 coord = destination.coord();
    float2 size = geometry.xy;
    if (any(coord < float2(0.0f)) || any(coord >= size)) return float4(0.0f);
    float2 halfSize = size * 0.5f;
    float2 p = coord - halfSize;
    float distance;
    if (geometry.w > 0.5f) {
        // Implicit ellipse distance near its boundary, in output pixels.
        float2 radii = max(halfSize, float2(0.001f));
        float2 normalized = p / radii;
        float gradient = max(length(2.0f * p / (radii * radii)), 0.000001f);
        distance = (dot(normalized, normalized) - 1.0f) / gradient;
    } else {
        float radius = clamp(geometry.z, 0.0f, min(halfSize.x, halfSize.y));
        float2 q = abs(p) - halfSize + radius;
        distance = length(max(q, float2(0.0f))) + min(max(q.x, q.y), 0.0f) - radius;
    }
    float coverage = clamp(0.5f - distance, 0.0f, 1.0f);
    if (settings.y > 0.5f) coverage -= clamp(0.5f - distance - settings.x, 0.0f, 1.0f);
    float alpha = max(0.0f, coverage) * color.a;
    return float4(color.rgb * alpha, alpha);
}

[[stitchable]] float4 sceneGradient(coreimage::sampler colors, coreimage::sampler positions,
                                   float4 geometry, float4 settings, coreimage::destination destination) {
    float2 coord = destination.coord() - geometry.xy;
    if (any(coord < float2(0.0f)) || any(coord >= geometry.zw)) return float4(0.0f);
    float2 p = coord - geometry.zw * 0.5f;
    float t;
    if (settings.x > 0.5f) t = length(p) / (length(geometry.zw) * 0.5f);
    else {
        float2 d = float2(sin(settings.y), cos(settings.y));
        t = 0.5f + dot(p, d) / max(0.001f, dot(geometry.zw, abs(d)));
    }
    float previousPosition = positions.sample(positions.transform(float2(0.5f, 0.5f))).r;
    float4 previousColor = colors.sample(colors.transform(float2(0.5f, 0.5f)));
    for (int i = 1; i < int(settings.z); ++i) {
        float2 sampleCoord = float2(float(i) + 0.5f, 0.5f);
        float nextPosition = positions.sample(positions.transform(sampleCoord)).r;
        float4 nextColor = colors.sample(colors.transform(sampleCoord));
        if (t <= nextPosition) {
            float amount = clamp((t - previousPosition) / max(0.00001f, nextPosition - previousPosition), 0.0f, 1.0f);
            float4 value = mix(previousColor, nextColor, amount);
            return float4(value.rgb * value.a, value.a);
        }
        previousPosition = nextPosition; previousColor = nextColor;
    }
    return float4(previousColor.rgb * previousColor.a, previousColor.a);
}

// Inputs are premultiplied sRGB. Only detail/color near the seam changes; original
// alpha survives local alignment, then the feather reveals the actual layer beneath.
[[stitchable]] float4 seamBlend(coreimage::sampler source, coreimage::sampler coverage,
                                coreimage::sampler path, float4 size, float4 bounds,
                                float4 settings, float2 shift, float3 gain, float3 bias,
                                coreimage::destination destination) {
    float2 coord = destination.coord();
    if (any(coord < float2(0.0f)) || any(coord >= size.xy)) return float4(0.0f);
    float4 pixel = source.sample(source.transform(coord));
    float covered = coverage.sample(coverage.transform(coord)).a;
    if (covered <= 0.0f) return pixel;
    // Core Image is y-up; all saved geometry and path coordinates are y-down.
    float2 localCoord = float2(coord.x, size.y - coord.y);
    bool horizontal = size.z > 0.5f;
    float cross = horizontal ? localCoord.x : localCoord.y;
    float minCross = horizontal ? bounds.x : bounds.y;
    float crossSize = horizontal ? bounds.z : bounds.w;
    float along = ((horizontal ? localCoord.y : localCoord.x) - (horizontal ? bounds.y : bounds.x)) /
                  (horizontal ? bounds.w : bounds.z);
    float pathCoord = clamp(along, 0.0f, 1.0f) * (settings.z - 1.0f) + 0.5f;
    float center = settings.y + path.sample(path.transform(float2(pathCoord, 0.5f))).r - 0.5f;
    float boundary = minCross + clamp(center, 0.05f, 0.95f) * crossSize;
    float distance = (cross - boundary) * size.w;
    float feather = settings.x;
    float alpha = round((1.0f - covered * (1.0f - smoothstep(0.0f, 1.0f, distance / feather + 0.5f))) * 255.0f) / 255.0f;
    float edgeDistance = min(cross - minCross, minCross + crossSize - cross);
    float weight = max(0.0f, 1.0f - abs(distance) / feather) * smoothstep(0.0f, 1.0f, edgeDistance / (feather * 0.5f)) * covered;
    weight = round(weight * 255.0f) / 255.0f;
    if (weight > 0.0f) {
        if (any(abs(shift) > 0.01f)) {
            float2 sampleCoord = clamp(coord + float2(-shift.x, shift.y) * weight, float2(0.5f), size.xy - 0.5f);
            float4 sampled = source.sample(source.transform(sampleCoord));
            if (sampled.a > 1.0f / 255.0f)
                pixel.rgb = round(clamp(sampled.rgb * pixel.a / sampled.a, 0.0f, 1.0f) * 255.0f) / 255.0f;
        }
        if (settings.w > 0.0f && pixel.a > 0.0f) {
            float3 straight = round(clamp(pixel.rgb / pixel.a, 0.0f, 1.0f) * 255.0f) / 255.0f;
            float3 linear = seamLinear(straight);
            float3 corrected = clamp(linear * gain + bias, 0.0f, 1.0f);
            float3 value = floor(mix(linear, corrected, weight * settings.w) * 65535.0f) / 65535.0f;
            float3 encoded = round(clamp(seamEncoded(value), 0.0f, 1.0f) * 255.0f) / 255.0f;
            pixel.rgb = round(encoded * pixel.a * 255.0f) / 255.0f;
        }
    }
    return round(pixel * alpha * 255.0f) / 255.0f;
}
