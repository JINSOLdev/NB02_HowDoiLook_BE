import type { Request, Response } from 'express';
import { getTodayWeather } from '../services/weather.service.ts';
import { recommendOutfits } from '../services/outfit.recommendation.service.ts';

type ImageRequest = Request & { file?: Express.Multer.File };

type HttpError = Error & { statusCode?: number };

function getCoordinate(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : undefined;
}

export async function createOutfitRecommendation(req: ImageRequest, res: Response): Promise<void> {
  const latitude = getCoordinate(req.body?.latitude, -90, 90);
  const longitude = getCoordinate(req.body?.longitude, -180, 180);

  if (latitude === undefined || longitude === undefined) {
    res.status(400).json({ message: 'latitude와 longitude를 유효한 숫자로 보내 주세요.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ message: 'image 필드에 옷장 사진을 첨부해 주세요.' });
    return;
  }

  try {
    const weather = await getTodayWeather(latitude, longitude);
    const recommendation = await recommendOutfits(req.file.buffer, req.file.mimetype, weather);
    res.status(200).json({ weather, ...recommendation });
  } catch (error) {
    const serviceError = error as HttpError;
    const statusCode = serviceError.statusCode ?? 502;
    const message =
      serviceError.statusCode && error instanceof Error
        ? error.message
        : '코디 추천을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.';

    console.error('Outfit recommendation request failed:', error);
    res.status(statusCode).json({ message });
  }
}
