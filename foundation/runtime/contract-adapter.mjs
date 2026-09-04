import { normalizeDisplayText } from './normalization-adapter.mjs';

export const RECOGNITION_DOCUMENT_CONTRACT = 'recognition-document/1.1';

const IMAGE_ROLES = new Set(['front', 'back', 'side', 'date', 'text']);

function confidence(value, fallback = 0.75) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function point(value) {
  if (Array.isArray(value)) return { x: Number(value[0]), y: Number(value[1]) };
  return { x: Number(value?.x), y: Number(value?.y) };
}

function polygon(value) {
  if (!Array.isArray(value)) return null;
  const points = value.map(point).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
  return points.length >= 2 ? points : null;
}

function box(value, polygonValue) {
  const source = value && typeof value === 'object' ? value : null;
  if (source) {
    const left = Number(source.left ?? source.x);
    const top = Number(source.top ?? source.y);
    const right = Number(source.right ?? (left + Number(source.width)));
    const bottom = Number(source.bottom ?? (top + Number(source.height)));
    if ([left, top, right, bottom].every(Number.isFinite)) {
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      return { left, right, top, bottom, width, height, centerX: left + width / 2, centerY: top + height / 2 };
    }
  }
  if (!Array.isArray(polygonValue) || polygonValue.length < 2) return null;
  const xs = polygonValue.map((item) => item.x);
  const ys = polygonValue.map((item) => item.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  return { left, right, top, bottom, width: right - left, height: bottom - top, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}

export function adaptRecognitionDocument(input = {}) {
  const images = (input.images || []).map((image, index) => {
    const role = IMAGE_ROLES.has(image?.role) ? image.role : 'side';
    return {
      id: String(image?.id || `image-${index + 1}`),
      role,
      roleLabel: String(image?.roleLabel || role),
      order: Number.isInteger(image?.order) ? image.order : index,
      ...(image?.fileName ? { fileName: String(image.fileName) } : {}),
      ...(typeof image?.nativeSource === 'boolean' ? { nativeSource: image.nativeSource } : {})
    };
  });
  const fallbackImage = images[0] || { id: 'text-1', role: 'text', roleLabel: 'text', order: 0 };
  if (!images.length) images.push(fallbackImage);
  const imageById = new Map(images.map((image) => [image.id, image]));
  const blocks = (input.blocks || []).map((block, index) => {
    const image = imageById.get(String(block?.imageId || '')) || fallbackImage;
    const text = normalizeDisplayText(block?.text ?? block?.rawText ?? block?.rawValue ?? block?.value);
    const normalizedPolygon = polygon(block?.polygon ?? block?.corners);
    const normalizedBox = box(block?.box ?? block?.boundingBox, normalizedPolygon);
    return {
      id: String(block?.id || block?.blockId || `${image.id}:block-${index + 1}`),
      imageId: image.id,
      imageRole: image.role,
      order: Number.isInteger(block?.order) ? block.order : index,
      text,
      ...(block?.rawText != null ? { rawText: String(block.rawText) } : {}),
      confidence: confidence(block?.confidence ?? block?.score),
      polygon: normalizedPolygon,
      engine: String(block?.engine || input.engine || 'unknown'),
      box: normalizedBox,
      ...(block?.fieldAnchor ? { fieldAnchor: String(block.fieldAnchor) } : {}),
      ...(Number.isFinite(Number(block?.fieldAnchorConfidence)) ? { fieldAnchorConfidence: confidence(block.fieldAnchorConfidence) } : {})
    };
  }).filter((block) => block.text);

  return {
    schemaVersion: RECOGNITION_DOCUMENT_CONTRACT,
    parserVersion: String(input.parserVersion || 'coffee-foundation-adapter/1.0'),
    engine: String(input.engine || 'unknown'),
    createdAt: String(input.createdAt || new Date().toISOString()),
    rawFullText: String(input.rawFullText || input.fullText || blocks.map((block) => block.text).join('\n')),
    fullText: String(input.fullText || blocks.map((block) => block.text).join('\n')),
    images,
    blocks,
    relations: Array.isArray(input.relations) ? input.relations : [],
    ...(input.extensions && typeof input.extensions === 'object' ? { extensions: input.extensions } : {})
  };
}
