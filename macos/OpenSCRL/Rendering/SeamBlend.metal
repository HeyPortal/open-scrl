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

// MARK: - Refined seam

float seamSmoother(float t) {
    t = clamp(t, 0.0f, 1.0f);
    return t * t * t * (t * (t * 6.0f - 15.0f) + 10.0f);
}

// x: signed distance to the seam in output pixels, positive toward the foreground.
// y: normalized position along the seam. z, w: overlap room on the partner and foreground sides.
float4 seamGeometry(float2 coord, coreimage::sampler path, float4 size, float4 bounds, float2 seam) {
    // Core Image is y-up; saved geometry and paths are y-down.
    float2 local = float2(coord.x, size.y - coord.y);
    bool horizontal = size.z > 0.5f;
    float cross = horizontal ? local.x : local.y;
    float minCross = horizontal ? bounds.x : bounds.y;
    float crossSize = horizontal ? bounds.z : bounds.w;
    float along = clamp(((horizontal ? local.y : local.x) - (horizontal ? bounds.y : bounds.x)) /
                        (horizontal ? bounds.w : bounds.z), 0.0f, 1.0f);
    float pathValue = path.sample(path.transform(float2(along * (seam.y - 1.0f) + 0.5f, 0.5f))).r;
    float boundary = minCross + clamp(seam.x + pathValue - 0.5f, 0.05f, 0.95f) * crossSize;
    float before = boundary - minCross, after = minCross + crossSize - boundary;
    bool forward = size.w > 0.0f;
    return float4((cross - boundary) * size.w, along, forward ? before : after, forward ? after : before);
}

float seamHash(int2 p) {
    uint h = uint(p.x) * 0x8da6b343u ^ uint(p.y) * 0xd8163841u;
    h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15;
    return float(h & 0xffffu) / 32767.5f - 1.0f;
}

float seamValueNoise(float2 p) {
    float2 i = floor(p), f = p - i;
    float2 u = f * f * (3.0f - 2.0f * f);
    int2 c = int2(i);
    return mix(mix(seamHash(c), seamHash(c + int2(1, 0)), u.x),
               mix(seamHash(c + int2(0, 1)), seamHash(c + int2(1, 1)), u.x), u.y);
}

// Four rotated octaves, roughly within [-1, 1].
float seamFBM(float2 p) {
    float sum = 0.0f, amplitude = 0.5f;
    for (int i = 0; i < 4; ++i) {
        sum += amplitude * seamValueNoise(p);
        p = float2(p.x * 1.6f - p.y * 1.2f, p.x * 1.2f + p.y * 1.6f) + 17.0f;
        amplitude *= 0.5f;
    }
    return sum / 0.9375f;
}

// Aligns and color-matches the foreground. Both corrections are strongest at the seam and
// fade with distance, so the photo returns to its original pixels away from the overlap.
// seam: position, path samples, regions, alignment reach (px). tone: color match, color
// reach (px; 0 matches the whole photo). The profile holds gain, bias and shift rows.
[[stitchable]] float4 seamPrepare(coreimage::sampler source, coreimage::sampler path, coreimage::sampler profile,
                                  float4 size, float4 bounds, float4 seam, float4 tone,
                                  coreimage::destination destination) {
    float2 coord = destination.coord();
    if (any(coord < float2(0.0f)) || any(coord >= size.xy)) return float4(0.0f);
    float4 original = source.sample(source.transform(coord));
    if (original.a <= 0.0f) return original;
    float4 geometry = seamGeometry(coord, path, size, bounds, seam.xy);
    float d = geometry.x;
    float region = geometry.y * (seam.z - 1.0f) + 0.5f;
    float alignRamp = d <= 0.0f ? 1.0f : 1.0f - seamSmoother(d / max(seam.w, 1.0f));
    float colorRamp = tone.y <= 0.0f || d <= 0.0f ? 1.0f : 1.0f - seamSmoother(d / tone.y);
    float4 pixel = original;
    float2 shift = profile.sample(profile.transform(float2(region, 2.5f))).rg;
    if (alignRamp > 0.0f && any(abs(shift) > 0.01f)) {
        float2 sampleCoord = clamp(coord + float2(-shift.x, shift.y) * alignRamp, float2(0.5f), size.xy - 0.5f);
        float4 sampled = source.sample(source.transform(sampleCoord));
        // Alignment moves detail but keeps the original coverage.
        if (sampled.a > 1.0f / 255.0f) pixel.rgb = clamp(sampled.rgb / sampled.a, 0.0f, 1.0f) * original.a;
    }
    if (tone.x > 0.0f && colorRamp > 0.0f) {
        float3 linear = seamLinear(clamp(pixel.rgb / pixel.a, 0.0f, 1.0f));
        float3 gain = profile.sample(profile.transform(float2(region, 0.5f))).rgb;
        float3 bias = profile.sample(profile.transform(float2(region, 1.5f))).rgb;
        linear = mix(linear, clamp(linear * gain + bias, 0.0f, 1.0f), colorRamp * tone.x);
        pixel.rgb = clamp(seamEncoded(linear), 0.0f, 1.0f) * pixel.a;
    }
    return pixel;
}

// The color difference inside the overlap, offset to stay positive and weighted by where
// both photos exist. Blurring it at several scales gives every frequency band its own blend.
[[stitchable]] float4 seamDifference(coreimage::sample_t a, coreimage::sample_t b) {
    float weight = a.a * b.a;
    if (weight <= 0.0f) return float4(0.0f);
    float3 difference = clamp(a.rgb / a.a, 0.0f, 1.0f) - clamp(b.rgb / b.a, 0.0f, 1.0f);
    return float4((0.5f + 0.5f * difference) * weight, weight);
}

float3 seamBand(coreimage::sampler level, float2 coord) {
    float4 value = level.sample(level.transform(coord));
    return value.a > 0.0001f ? (value.rgb / value.a - 0.5f) * 2.0f : float3(0.0f);
}

float seamStep(float d, float width) {
    return smoothstep(0.0f, 1.0f, d / width + 0.5f);
}

// Seamless styles cross the detail over a short span. Soft adds a multi-band blend
// (Burt & Adelson): each coarser band crosses over a wider span, up to the whole overlap.
// Where the partner fully covers, the result replaces both photos; along its soft edges the
// foreground falls back to an alpha mask over the partner drawn beneath.
// seam: position, path samples, detail width (px), soft. bands: first sigma (px), levels,
// softness. style: edge kind, amplitude (px), noise scale (project units). unit: pixels per
// project unit, so textures stay attached to the layer at every zoom.
[[stitchable]] float4 seamComposite(coreimage::sampler prepared, coreimage::sampler partner, coreimage::sampler path,
                                    coreimage::sampler level1, coreimage::sampler level2, coreimage::sampler level3,
                                    coreimage::sampler level4, coreimage::sampler level5, coreimage::sampler level6,
                                    float4 size, float4 bounds, float4 seam, float4 bands, float4 style, float2 unit,
                                    coreimage::destination destination) {
    float2 coord = destination.coord();
    if (any(coord < float2(0.0f)) || any(coord >= size.xy)) return float4(0.0f);
    float4 a = prepared.sample(prepared.transform(coord));
    float4 b = partner.sample(partner.transform(coord));
    float covered = b.a;
    if (covered <= 0.0f) return a;
    float4 geometry = seamGeometry(coord, path, size, bounds, seam.xy);
    float d = geometry.x;
    float room = max(0.0f, min(geometry.z, geometry.w));
    float2 local = float2(coord.x, size.y - coord.y) / unit;
    int kind = int(style.x + 0.5f);
    // Organic drifts in two dimensions, like mist.
    if (kind == 1) d += style.y * seamFBM(local / style.z);
    float3 fore = a.a > 0.0f ? clamp(a.rgb / a.a, 0.0f, 1.0f) : float3(0.0f);
    float3 back = clamp(b.rgb / b.a, 0.0f, 1.0f);
    float mask = seamStep(d, max(1.0f, min(seam.z, 2.0f * room)));
    float3 result = mix(back, fore, mask);
    if (seam.w > 0.5f) {
        int levels = int(bands.y + 0.5f);
        float sigma = bands.x, previous = mask;
        for (int i = 1; i <= levels; ++i) {
            float width = max(1.0f, min(max(seam.z, 4.0f * sigma * bands.z), 2.0f * room));
            float next = seamStep(d, width);
            float3 band = i == 1 ? seamBand(level1, coord) : i == 2 ? seamBand(level2, coord)
                        : i == 3 ? seamBand(level3, coord) : i == 4 ? seamBand(level4, coord)
                        : i == 5 ? seamBand(level5, coord) : seamBand(level6, coord);
            result += (next - previous) * band;
            previous = next;
            sigma *= 2.0f;
        }
        mask = previous;
    }
    float4 feathered = a * (1.0f - covered * (1.0f - mask));
    float solid = smoothstep(0.96f, 1.0f, covered) * a.a;
    return mix(feathered, float4(clamp(result, 0.0f, 1.0f), 1.0f), solid);
}

// Screens a soft bloom of the blended pixels over the seam, in linear light.
// seam: position, path samples. glow: strength, width (px), bloom gain.
[[stitchable]] float4 seamGlow(coreimage::sampler composite, coreimage::sampler bloom, coreimage::sampler path,
                               float4 size, float4 bounds, float4 seam, float4 glow,
                               coreimage::destination destination) {
    float2 coord = destination.coord();
    if (any(coord < float2(0.0f)) || any(coord >= size.xy)) return float4(0.0f);
    float4 pixel = composite.sample(composite.transform(coord));
    if (pixel.a <= 0.0f) return pixel;
    float4 geometry = seamGeometry(coord, path, size, bounds, seam.xy);
    float d = geometry.x;
    float amount = glow.x * exp(-0.5f * (d / glow.y) * (d / glow.y));
    // The foreground ends at the partner-side edge of the overlap; fade out before it.
    amount *= smoothstep(0.0f, 1.0f, (d + geometry.z) / max(1.0f, 0.6f * geometry.z));
    if (amount <= 0.0005f) return pixel;
    float4 light = bloom.sample(bloom.transform(coord));
    float3 lightColor = light.a > 0.0f ? seamLinear(clamp(light.rgb / light.a, 0.0f, 1.0f)) : float3(0.0f);
    float3 base = seamLinear(clamp(pixel.rgb / pixel.a, 0.0f, 1.0f));
    base = 1.0f - (1.0f - base) * (1.0f - clamp(lightColor * glow.z, 0.0f, 1.0f) * amount);
    return float4(clamp(seamEncoded(base), 0.0f, 1.0f) * pixel.a, pixel.a);
}
