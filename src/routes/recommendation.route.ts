import { Router } from 'express';
import { createOutfitRecommendation } from '../controllers/recommendation.controller.ts';
import { createImageMemoryUpload } from '../middlewares/image.analysis.middleware.ts';

const router = Router();

router.post('/outfit', createImageMemoryUpload(2), createOutfitRecommendation);

export default router;
