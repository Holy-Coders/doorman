// Original Janitor continuity field. Bounded, periodic, no textures or randomness.
struct VertexInput {
  @location(0) position: vec2<f32>,
  @location(1) tex_coords: vec2<f32>,
  @location(2) color: vec4<f32>,
};
struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) tex_coords: vec2<f32>,
};
@vertex fn vs_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clip_position = vec4<f32>(input.position, 0.0, 1.0);
  out.tex_coords = input.tex_coords;
  return out;
}
struct Params { animationTime: f32, period: f32, intensity: f32, _pad: f32 };
@group(0) @binding(0) var t_texture: texture_2d<f32>;
@group(0) @binding(1) var s_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn rotate(p: vec2<f32>, a: f32) -> vec2<f32> {
  return vec2<f32>(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);
}
fn line(d: f32, width: f32) -> f32 {
  return 1.0 - smoothstep(width, width + 0.0008, abs(d));
}
fn field(uv: vec2<f32>) -> vec3<f32> {
  let t = params.animationTime / params.period * 6.2831853;
  let p = (uv - vec2<f32>(0.50,0.50)) * vec2<f32>(3.55556,2.0);
  let mint = vec3<f32>(0.714,0.961,0.808);
  var col = vec3<f32>(0.03137,0.04706,0.04706);
  // A faint, local pool of light: black margins remain clear for HTML copy.
  // Keep the background flat; let defined contours carry the motion.
  let q = rotate(p, -0.34);
  let tilt = 0.76 + 0.035*sin(t);
  let radial = length(vec2<f32>(q.x, q.y/tilt));
  let angle = atan2(q.y/tilt, q.x);
  let scan = pow(0.5 + 0.5*cos(angle-t), 24.0);
  // Fine concentric records. Their spacing and phase form a softly turning rim.
  for(var i=0; i<18; i=i+1) {
    let f = f32(i)/17.0;
    let radius = 0.39 + f*0.46;
    let wave = 0.017*sin(angle*3.0 + t) * sin(f*3.14159265);
    let edge = line(radial-radius-wave, 0.0012);
    let rim = 0.16 + 0.22*pow(0.5+0.5*cos(angle+1.2),6.0) + 0.38*scan;
    let contour = 0.45 + 0.55*sin(f*3.14159265);
    col += mint*edge*rim*contour*params.intensity;
  }
  // Three independently preserved traces run around the same stable environment.
  for(var j=0; j<3; j=j+1) {
    let f=f32(j);
    let e=rotate(p, -0.34 + f*0.032);
    let r=length(vec2<f32>(e.x, e.y/(0.76+0.035*sin(t))));
    let a=atan2(e.y/tilt,e.x);
    let trace=line(r-(0.9+f*0.055),0.0010);
    let pulse=pow(0.5+0.5*cos(a-t-f*1.7),100.0);
    col += mint*trace*(0.18+pulse*0.7);
  }
  // Quiet instrument ticks, fixed rather than particle noise.
  let tick = pow(abs(cos(angle*48.0)), 30.0);
  col += mint*tick*(1.0-smoothstep(0.014,0.017,abs(radial-1.09)))*0.18;
  let centerShade = smoothstep(0.18,0.36,length(p));
  return mix(vec3<f32>(0.03137,0.04706,0.04706),col,centerShade);
}
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(clamp(field(input.tex_coords),vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}
