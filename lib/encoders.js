'use strict';
// H.264 encoder settings for the live stream.
//
// Live streams to YouTube/Facebook already have several seconds of delay, so we spend nothing
// on "zero latency": B-frames and look-ahead are on, which gives a cleaner picture at the same
// bitrate (the same choices OBS makes by default). Bitrate stays constant (CBR) with a keyframe
// every 2 seconds, as both platforms ask.
//
// Each encoder has a 'quality' set and a plainer 'compat' set. When ChurchStream checks which
// encoder works on this computer it tries 'quality' first; a graphics driver that rejects an
// option falls back to 'compat' (written "h264_nvenc:compat").

function splitEncoder(encoder) {
  const [name, variant] = String(encoder || 'libx264').split(':');
  return { name, variant: variant === 'compat' ? 'compat' : 'quality' };
}

function encoderArgs(encoder, q) {
  const { name, variant } = splitEncoder(encoder);
  const b = `${q.vbit}k`;
  const gop = String(q.fps * 2); // keyframe every 2 s (YouTube/Facebook recommendation)
  const rate = ['-b:v', b, '-maxrate', b, '-bufsize', `${q.vbit * 2}k`, '-g', gop];
  const quality = variant === 'quality';
  switch (name) {
    case 'h264_nvenc':
      return quality
        ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'cbr', ...rate, '-bf', '2', '-rc-lookahead', '20', '-spatial-aq', '1', '-profile:v', 'high']
        : ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr', ...rate, '-bf', '0'];
    case 'h264_qsv':
      return quality
        ? ['-c:v', 'h264_qsv', '-preset', 'medium', ...rate, '-bf', '2', '-profile:v', 'high']
        : ['-c:v', 'h264_qsv', '-preset', 'veryfast', ...rate, '-bf', '0'];
    case 'h264_amf':
      return quality
        ? ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cbr', ...rate, '-profile:v', 'high']
        : ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-rc', 'cbr', ...rate, '-bf', '0'];
    case 'h264_videotoolbox':
      return quality
        ? ['-c:v', 'h264_videotoolbox', '-profile:v', 'high', ...rate]
        : ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-profile:v', 'main', ...rate, '-bf', '0'];
    default:
      return quality
        ? ['-c:v', 'libx264', '-preset', 'veryfast', ...rate, '-bf', '2', '-keyint_min', gop, '-sc_threshold', '0', '-profile:v', 'high']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', ...rate, '-keyint_min', gop, '-sc_threshold', '0', '-profile:v', 'main'];
  }
}

module.exports = { encoderArgs, splitEncoder };
