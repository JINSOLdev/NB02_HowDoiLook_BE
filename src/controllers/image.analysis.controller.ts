import type { Request, Response } from 'express';
import { analyzeClothingImage } from '../services/image.analysis.service.ts';
import { ModelApiError } from '../services/meta.model.service.ts';

export async function analyzeImage(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ message: 'image 필드에 분석할 옷 이미지 한 장을 첨부해 주세요.' });
    return;
  }

  try {
    const analysis = await analyzeClothingImage(req.file.buffer, req.file.mimetype);
    res.status(200).json(analysis);
  } catch (error) {
    const statusCode = error instanceof ModelApiError ? error.statusCode : 502;
    const message =
      error instanceof ModelApiError ? error.message : '이미지를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    res.status(statusCode).json({ message });
  }
}
