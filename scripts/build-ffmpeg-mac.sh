#!/bin/bash
# Builds the FFmpeg that ChurchStream bundles on a Mac: static (no Homebrew libraries needed on
# the church's Mac), for Apple chips (arm64) or Intel (x86_64, cross-compiled), with what
# ChurchStream uses — including the zmq filter that the studio sends its live commands through
# (no ready-made Mac build has it).
#
#   scripts/build-ffmpeg-mac.sh arm64|x86_64 <output.zip>
#
# Needs: Xcode command line tools, cmake, and from Homebrew: nasm meson ninja pkg-config.
# Takes 10–20 minutes; CI caches the result (see .github/workflows/windows-build.yml).
set -euo pipefail
ARCH=${1:?arm64 or x86_64}
OUT=$(cd "$(dirname "${2:?output zip}")" && pwd)/$(basename "$2")

FFMPEG_TAGS="n8.1 n8.0.1 n8.0"
X264_URL=https://code.videolan.org/videolan/x264/-/archive/stable/x264-stable.tar.bz2
ZMQ_URL=https://github.com/zeromq/libzmq/releases/download/v4.3.5/zeromq-4.3.5.tar.gz
FREETYPE_URL=https://github.com/freetype/freetype/archive/refs/tags/VER-2-13-3.tar.gz
HARFBUZZ_URL=https://github.com/harfbuzz/harfbuzz/releases/download/10.1.0/harfbuzz-10.1.0.tar.xz
MBEDTLS_URL=https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.2/mbedtls-3.6.2.tar.bz2

MIN=11.0
WORK=$(mktemp -d)
PREFIX=$WORK/prefix
SRC=$WORK/src
mkdir -p "$PREFIX" "$SRC"
JOBS=$(sysctl -n hw.ncpu)
HOST_ARCH=$(uname -m)
CROSS=0; [ "$ARCH" != "$HOST_ARCH" ] && CROSS=1
export CFLAGS="-arch $ARCH -mmacosx-version-min=$MIN -O2"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-arch $ARCH -mmacosx-version-min=$MIN"
export MACOSX_DEPLOYMENT_TARGET=$MIN
# Only our own libraries: never Homebrew's (they wouldn't be on the church's Mac).
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig
export PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig
CMAKE=(cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_OSX_ARCHITECTURES="$ARCH" -DCMAKE_OSX_DEPLOYMENT_TARGET=$MIN -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON)

get() { # url dir
  mkdir -p "$SRC/$2"
  curl -sSfL --retry 3 "$1" -o "$SRC/$2.tar"
  tar -xf "$SRC/$2.tar" -C "$SRC/$2" --strip-components 1
}
step() { echo; echo "▸ $* ($ARCH)"; }

step "ZeroMQ"
get "$ZMQ_URL" zmq
"${CMAKE[@]}" -S "$SRC/zmq" -B "$SRC/zmq/b" -DBUILD_STATIC=ON -DBUILD_SHARED=OFF -DBUILD_TESTS=OFF -DWITH_LIBSODIUM=OFF -DENABLE_CURVE=OFF \
  -DWITH_DOCS=OFF -DENABLE_DRAFTS=OFF -DWITH_PERF_TOOL=OFF -DENABLE_CPACK=OFF -DZMQ_BUILD_TESTS=OFF > /dev/null
cmake --build "$SRC/zmq/b" -j "$JOBS" > /dev/null
cmake --install "$SRC/zmq/b" > /dev/null

step "FreeType"
get "$FREETYPE_URL" freetype
"${CMAKE[@]}" -S "$SRC/freetype" -B "$SRC/freetype/b" -DFT_DISABLE_ZLIB=TRUE -DFT_DISABLE_BZIP2=TRUE -DFT_DISABLE_PNG=TRUE \
  -DFT_DISABLE_HARFBUZZ=TRUE -DFT_DISABLE_BROTLI=TRUE > /dev/null
cmake --build "$SRC/freetype/b" -j "$JOBS" > /dev/null
cmake --install "$SRC/freetype/b" > /dev/null

step "HarfBuzz"
get "$HARFBUZZ_URL" harfbuzz
CROSSFILE=()
if [ $CROSS = 1 ]; then
  cat > "$WORK/cross.txt" <<EOF
[binaries]
c = 'clang'
cpp = 'clang++'
objc = 'clang'
ar = 'ar'
strip = 'strip'
pkg-config = 'pkg-config'
[built-in options]
c_args = ['-arch', '$ARCH', '-mmacosx-version-min=$MIN']
cpp_args = ['-arch', '$ARCH', '-mmacosx-version-min=$MIN']
c_link_args = ['-arch', '$ARCH', '-mmacosx-version-min=$MIN']
cpp_link_args = ['-arch', '$ARCH', '-mmacosx-version-min=$MIN']
[host_machine]
system = 'darwin'
cpu_family = '$ARCH'
cpu = '$ARCH'
endian = 'little'
EOF
  CROSSFILE=(--cross-file "$WORK/cross.txt")
fi
meson setup "$SRC/harfbuzz/b" "$SRC/harfbuzz" "${CROSSFILE[@]}" --prefix="$PREFIX" --libdir=lib --buildtype=release --default-library=static \
  -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dicu=disabled -Dchafa=disabled -Dgraphite2=disabled \
  -Dtests=disabled -Ddocs=disabled -Dintrospection=disabled -Dutilities=disabled -Dbenchmark=disabled -Dcoretext=disabled > /dev/null
ninja -C "$SRC/harfbuzz/b" > /dev/null
ninja -C "$SRC/harfbuzz/b" install > /dev/null

step "Mbed TLS (for rtmps://, e.g. Facebook)"
get "$MBEDTLS_URL" mbedtls
"${CMAKE[@]}" -S "$SRC/mbedtls" -B "$SRC/mbedtls/b" -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON -DUSE_SHARED_MBEDTLS_LIBRARY=OFF > /dev/null
cmake --build "$SRC/mbedtls/b" -j "$JOBS" > /dev/null
cmake --install "$SRC/mbedtls/b" > /dev/null

step "x264"
get "$X264_URL" x264
(
  cd "$SRC/x264"
  HOSTARG=(); [ $CROSS = 1 ] && HOSTARG=(--host="$ARCH-apple-darwin")
  [ "$ARCH" = arm64 ] && [ $CROSS = 1 ] && HOSTARG=(--host=aarch64-apple-darwin)
  ./configure --prefix="$PREFIX" --enable-static --disable-cli --enable-pic "${HOSTARG[@]}" \
    --extra-cflags="$CFLAGS" --extra-ldflags="$LDFLAGS" > /dev/null
  make -j "$JOBS" > /dev/null
  make install > /dev/null
)

step "FFmpeg"
FF=""
for tag in $FFMPEG_TAGS; do
  if curl -sSfL --retry 3 "https://github.com/FFmpeg/FFmpeg/archive/refs/tags/$tag.tar.gz" -o "$SRC/ffmpeg.tar"; then FF=$tag; break; fi
done
[ -n "$FF" ] || { echo "Could not download FFmpeg"; exit 1; }
mkdir -p "$SRC/ffmpeg" && tar -xf "$SRC/ffmpeg.tar" -C "$SRC/ffmpeg" --strip-components 1
cd "$SRC/ffmpeg"
CROSSARGS=(); [ $CROSS = 1 ] && CROSSARGS=(--enable-cross-compile)
./configure --prefix="$PREFIX" --arch="$ARCH" --target-os=darwin --cc=clang --cxx=clang++ "${CROSSARGS[@]}" \
  --extra-cflags="$CFLAGS -I$PREFIX/include" --extra-ldflags="$LDFLAGS -L$PREFIX/lib" --extra-libs="-lc++" \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --enable-gpl --enable-version3 --enable-static --disable-shared --disable-ffplay --disable-doc --disable-debug \
  --enable-libx264 --enable-libzmq --enable-libfreetype --enable-libharfbuzz --enable-mbedtls \
  --enable-videotoolbox --enable-audiotoolbox \
  --disable-sdl2 --disable-xlib --disable-libxcb --disable-lzma --disable-securetransport \
  --extra-version=churchstream > "$WORK/configure.log" || { tail -40 "$WORK/configure.log"; tail -60 ffbuild/config.log; exit 1; }
make -j "$JOBS" > /dev/null
strip ffmpeg ffprobe

step "Checking the result"
file ffmpeg
for lib in $(otool -L ffmpeg | tail -n +2 | awk '{print $1}'); do
  case "$lib" in /usr/lib/*|/System/*) ;; *) echo "Not a system library: $lib"; exit 1 ;; esac
done
if [ "$ARCH" = "$HOST_ARCH" ] || [ "$ARCH" = x86_64 ]; then
  ./ffmpeg -hide_banner -filters | grep -E " (zmq|drawtext|xstack|blend) " || { echo "Missing filters"; exit 1; }
  ./ffmpeg -hide_banner -encoders | grep -E " libx264 | h264_videotoolbox " || { echo "Missing H.264 encoders"; exit 1; }
fi

mkdir -p "$WORK/out"
cp ffmpeg ffprobe "$WORK/out/"
cat > "$WORK/out/LICENSE.txt" <<EOF
This ffmpeg was built by ChurchStream from unmodified sources (scripts/build-ffmpeg-mac.sh):
FFmpeg $FF (GPL v3; https://ffmpeg.org), x264 (GPL), ZeroMQ 4.3.5 (MPL 2.0), FreeType 2.13.3
(FreeType licence), HarfBuzz 10.1.0 (MIT), Mbed TLS 3.6.2 (Apache 2.0).
Source code: https://ffmpeg.org/download.html and the projects' own sites; the build script is in
ChurchStream's source (github.com/driviere/churchStream).
EOF
rm -f "$OUT"
(cd "$WORK/out" && zip -q "$OUT" ffmpeg ffprobe LICENSE.txt)
echo "✓ $OUT ($FF, $ARCH)"
