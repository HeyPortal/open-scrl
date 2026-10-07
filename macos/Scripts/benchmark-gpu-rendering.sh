#!/bin/zsh
set -euo pipefail
MAC_ROOT=${0:A:h:h}
OUTPUT=$MAC_ROOT/build/gpu-scene-performance
mkdir -p "$OUTPUT"
xcrun metal -c "$MAC_ROOT/OpenSCRL/Rendering/SeamBlend.metal" -o "$OUTPUT/scene.air"
xcrun metal "$OUTPUT/scene.air" -framework CoreImage -o "$OUTPUT/default.metallib"
xcrun swiftc -O -whole-module-optimization \
  "$MAC_ROOT/OpenSCRL/Model/Project.swift" \
  "$MAC_ROOT/OpenSCRL/Model/SeamBlend.swift" \
  "$MAC_ROOT/OpenSCRL/Model/Geometry.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/HexColor.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/Masks.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/Fonts.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/TextLayout.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/Renderer.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/SeamRenderer.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/SeamGPU.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/GPUImageProviding.swift" \
  "$MAC_ROOT/OpenSCRL/Rendering/GPUSceneRenderer.swift" \
  "$MAC_ROOT/Tests/GPUScenePerformance.swift" -o "$OUTPUT/check"
OPENSCRL_METALLIB="$OUTPUT/default.metallib" "$OUTPUT/check"
