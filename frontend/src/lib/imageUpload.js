const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_TARGET_BYTES = 3 * 1024 * 1024;
const DEFAULT_QUALITY = 0.86;
const MIN_QUALITY = 0.46;
const QUALITY_STEP = 0.08;

function toJpegName(name) {
  if (!name) return 'photo.jpg';
  const dot = name.lastIndexOf('.');
  if (dot === -1) return `${name}.jpg`;
  return `${name.slice(0, dot)}.jpg`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

export async function optimizeImageForUpload(file, options = {}) {
  if (!(file instanceof File) || !String(file.type || '').startsWith('image/')) {
    return file;
  }

  const maxDimension = Number(options.maxDimension) > 0
    ? Number(options.maxDimension)
    : DEFAULT_MAX_DIMENSION;
  const targetBytes = Number(options.targetBytes) > 0
    ? Number(options.targetBytes)
    : DEFAULT_TARGET_BYTES;

  try {
    const image = await loadImageFromFile(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const largestSide = Math.max(sourceWidth, sourceHeight);
    const scale = largestSide > maxDimension ? (maxDimension / largestSide) : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, width, height);

    let quality = DEFAULT_QUALITY;
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!blob) return file;

    while (blob.size > targetBytes && quality > MIN_QUALITY) {
      quality -= QUALITY_STEP;
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (!blob) return file;
    }

    if (blob.size >= file.size && file.size <= targetBytes) {
      return file;
    }

    return new File(
      [blob],
      toJpegName(file.name),
      { type: 'image/jpeg', lastModified: Date.now() }
    );
  } catch (_) {
    return file;
  }
}
