import { Router } from 'express';
import upload from '../middlewares/multer.middleware.ts';
import { ImageUploadController } from '../controllers/image.controller.ts';
import { analyzeImage } from '../controllers/image.analysis.controller.ts';
import { uploadImageForAnalysis } from '../middlewares/image.analysis.middleware.ts';

const router = Router();

const imageUploadController = new ImageUploadController();
const imageUpload = imageUploadController.uploadImage.bind(imageUploadController);

// 이미지 업로드
router.post('/', upload.single('image'), imageUpload);

router.post('/analyze', uploadImageForAnalysis, analyzeImage);

export default router;
