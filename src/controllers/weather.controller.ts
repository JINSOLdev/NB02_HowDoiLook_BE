import type { Request, Response } from 'express';
import { getTodayWeather } from '../services/weather.service.ts';

type HttpError = Error & { statusCode?: number };

function getCoordinate(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : undefined;
}

export async function getWeather(req: Request, res: Response): Promise<void> {
  const latitude = getCoordinate(req.query.latitude ?? req.query.lat, -90, 90);
  const longitude = getCoordinate(req.query.longitude ?? req.query.lon, -180, 180);

  if (latitude === undefined || longitude === undefined) {
    res.status(400).json({
      message: 'latitude와 longitude(또는 lat과 lon)를 유효한 query parameter로 보내 주세요.',
    });
    return;
  }

  try {
    const weather = await getTodayWeather(latitude, longitude);
    res.status(200).json(weather);
  } catch (error) {
    const serviceError = error as HttpError;
    const statusCode = serviceError.statusCode ?? 502;
    const message =
      serviceError.statusCode && error instanceof Error
        ? error.message
        : '날씨 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';

    console.error('Weather request failed:', error);
    res.status(statusCode).json({ message });
  }
}
