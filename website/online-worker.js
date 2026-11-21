self.onmessage = async ({ data: file }) => {
  const errors = [null, "format", "decode", "limit", "error"];
  try {
    const url = new URL("./online-converter.wasm?v=1", self.location.href);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Converter unavailable");
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
    const { memory, prepare_input, convert, output_pointer, output_length } = instance.exports;
    const input = await file.arrayBuffer();
    const pointer = prepare_input(input.byteLength);
    if (!pointer) {
      self.postMessage({ error: "limit" });
      return;
    }
    new Uint8Array(memory.buffer, pointer, input.byteLength).set(new Uint8Array(input));
    const result = convert();
    if (result !== 0) {
      self.postMessage({ error: errors[result] ?? "error" });
      return;
    }
    const webp = new Uint8Array(memory.buffer, output_pointer(), output_length()).slice().buffer;
    self.postMessage({ webp }, [webp]);
  } catch {
    self.postMessage({ error: "error" });
  }
};
