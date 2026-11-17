import type { RequestHandler } from 'express';
import multer from 'multer';

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxImageBytes = 8 * 1024 * 1024;

function matchesImageType(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    default:
      return false;
  }
}

export function createImageMemoryUpload(maxFields = 0): RequestHandler {
  const uploadImage = multer({
    storage: multer.memoryStorage(),
    // Busboy raises its limit at equality; allow one extra byte to keep 8 MiB inclusive.
    limits: { fileSize: maxImageBytes + 1, files: 1, fields: maxFields },
    fileFilter(_req, file, callback) {
      if (!supportedImageTypes.has(file.mimetype)) {
        callback(new Error('JPEG, PNG, WebP 이미지만 분석할 수 있습니다.'));
        return;
      }
      callback(null, true);
    },
  }).single('image');

  return (req, res, next) => {
    uploadImage(req, res, (error: unknown) => {
      if (error) {
        const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
        res.status(tooLarge ? 413 : 400).json({
          message: tooLarge
            ? '이미지는 8 MiB 이하여야 합니다.'
            : '요청 필드를 확인하고 image 필드에 JPEG, PNG, WebP 이미지 한 장만 첨부해 주세요.',
        });
        return;
      }

      if (req.file && req.file.size > maxImageBytes) {
        res.status(413).json({ message: '이미지는 8 MiB 이하여야 합니다.' });
        return;
      }

      if (req.file && !matchesImageType(req.file.buffer, req.file.mimetype)) {
        res.status(400).json({ message: '이미지 파일 내용이 JPEG, PNG, WebP 형식과 일치하지 않습니다.' });
        return;
      }
      next();
    });
  };
}

export const uploadImageForAnalysis = createImageMemoryUpload();
