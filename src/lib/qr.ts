import jsQR from "jsqr";

const MAX_SIDE = 1600;

async function toCanvas(file: File): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("这个设备不支持 canvas");

  let source: ImageBitmap | HTMLImageElement;
  let width: number;
  let height: number;

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("图片无法读取"));
        element.src = url;
      });
      source = image;
      width = image.naturalWidth || image.width;
      height = image.naturalHeight || image.height;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source && typeof source.close === "function") source.close();
  return canvas;
}

/** Decode a QR code out of a photo or screenshot. */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const canvas = await toCanvas(file);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(image.data, canvas.width, canvas.height, {
    inversionAttempts: "attemptBoth",
  });
  return result?.data ?? null;
}
