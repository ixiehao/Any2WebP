let filter;

export async function loadAdjustment() {
  const response = await fetch(new URL("./adjustment.wasm", import.meta.url));
  if (!response.ok) throw new Error("ui:unavailablePreviewEngine");
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  filter = instance.exports;
}

export function adjustImage(image, strengths) {
  const { shadows = 0, denoise = 0, sharpen = 0 } = strengths ?? {};
  if (!filter || !(shadows || denoise || sharpen)) return image;
  const { memory, __heap_base, adjust_rgba } = filter;
  const start = __heap_base.value;
  const size = image.data.byteLength;
  const required = start + 2 * size;
  if (required > memory.buffer.byteLength) {
    memory.grow(Math.ceil((required - memory.buffer.byteLength) / 65536));
  }
  const pixels = new Uint8ClampedArray(memory.buffer, start, size);
  pixels.set(image.data);
  adjust_rgba(start, start + size, image.width, image.height, shadows, denoise, sharpen);
  return new ImageData(pixels, image.width, image.height);
}
