import { Router } from 'express';
import multer from 'multer';
import { createOutfitRecommendation } from '../controllers/recommendation.controller.ts';

const router = Router();
const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const uploadClosetImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!supportedImageTypes.has(file.mimetype)) {
      callback(new Error('image must be JPEG, PNG, or WebP'));
      return;
    }
    callback(null, true);
  },
}).single('image');

router.post(
  '/outfit',
  (req, res, next) => {
    uploadClosetImage(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        res.status(statusCode).json({ message: error.message });
        return;
      }
      if (error) {
        res.status(400).json({ message: error.message });
        return;
      }
      next();
    });
  },
  createOutfitRecommendation
);

export default router;
