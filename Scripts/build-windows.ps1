param(
    [Parameter(Mandatory)] [string]$WebpSource,
    [Parameter(Mandatory)] [string]$GiflibSource
)

$ErrorActionPreference = 'Stop'
$webp = (Resolve-Path -LiteralPath $WebpSource).Path
$giflib = (Resolve-Path -LiteralPath $GiflibSource).Path
$triple = 'x86_64-pc-windows-msvc'
$project = Split-Path -Parent $PSScriptRoot
$work = Join-Path $project 'dist/windows-preview'
$codecBuild = Join-Path $work 'codec'
$targetDir = Join-Path $work 'cargo'
$oldTarget = $env:CARGO_TARGET_DIR
$oldFlags = $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS

function Invoke-BuildTool([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with status $LASTEXITCODE" }
}

Push-Location $project
try {
    $env:CARGO_TARGET_DIR = $targetDir
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = '-C target-feature=+crt-static'
    New-Item -ItemType Directory -Force -Path $work, 'src-tauri/binaries' | Out-Null
    $compiler = if ($env:CC) { $env:CC } else { 'cl' }
    Invoke-BuildTool cmake @('-S', 'engine/windows', '-B', $codecBuild, '-G', 'Ninja',
        "-DCMAKE_C_COMPILER=$compiler", '-DCMAKE_BUILD_TYPE=Release', "-DANY2WEBP_WEBP_SOURCE:PATH=$webp", "-DANY2WEBP_GIF_SOURCE:PATH=$giflib")
    Invoke-BuildTool cmake @('--build', $codecBuild)
    Copy-Item -LiteralPath (Join-Path $codecBuild 'any2webp-codec.exe') -Destination "src-tauri/binaries/any2webp-codec-$triple.exe"

    $object = Join-Path $work 'adjustment.o'
    $wasm = Join-Path $work 'adjustment.wasm'
    $wasmCompiler = if ($env:ANY2WEBP_WASM_CLANG) { $env:ANY2WEBP_WASM_CLANG } else { 'clang' }
    $rustLib = & rustc --print target-libdir
    if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the Rust WASM linker' }
    $wasmLinker = Join-Path (Split-Path -Parent $rustLib) 'bin/rust-lld.exe'
    Invoke-BuildTool $wasmCompiler @('--target=wasm32-unknown-unknown', '-std=c11', '-O3', '-ffp-contract=off',
        '-ffreestanding', '-fno-builtin', '-c', 'engine/adjustment.c', '-o', $object)
    Invoke-BuildTool $wasmLinker @('-flavor', 'wasm', '--no-entry', '--export=adjust_rgba',
        '--export=__heap_base', '--strip-all', $object, '-o', $wasm)
    Copy-Item -LiteralPath $wasm -Destination 'app/adjustment.wasm'

    $notices = Join-Path $work 'RUST-NOTICES.txt'
    Invoke-BuildTool python @('Scripts/collect-rust-notices.py', $triple, $notices)
    $resources = @{
        '../LICENSE' = 'LICENSE'
        '../docs/THIRD-PARTY-NOTICES.txt' = 'THIRD-PARTY-NOTICES.txt'
        '../docs/licenses/libwebp-PATENTS.txt' = 'libwebp-PATENTS.txt'
    }
    $resources[$notices] = 'RUST-NOTICES.txt'
    $config = Join-Path $work 'bundle.json'
    $json = @{ bundle = @{ useLocalToolsDir = $true; resources = $resources } } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($config, $json, [Text.UTF8Encoding]::new($false))
    Invoke-BuildTool cargo @('tauri', 'build', '--target', $triple, '--ci', '--no-sign',
        '--config', $config, '--', '--locked')
    Get-ChildItem -LiteralPath (Join-Path $targetDir "$triple/release/bundle/nsis") -Filter '*-setup.exe' |
        Get-FileHash -Algorithm SHA256
} finally {
    $env:CARGO_TARGET_DIR = $oldTarget
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = $oldFlags
    Pop-Location
}
