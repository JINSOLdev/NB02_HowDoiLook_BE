import type { TodayWeather } from './weather.service.ts';
import { ModelApiError, requestStructuredImageAnalysis } from './meta.model.service.ts';

export type ClosetItem = {
  category: string;
  color: string;
  description: string;
};

export type Outfit = {
  name: string;
  items: string[];
  reason: string;
  tips: string;
};

export type OutfitRecommendation = {
  closetItems: ClosetItem[];
  outfits: Outfit[];
  weatherAdvice: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const recommendationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['closetItems', 'outfits', 'weatherAdvice'],
  properties: {
    closetItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'color', 'description'],
        properties: {
          category: { type: 'string' },
          color: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    outfits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'items', 'reason', 'tips'],
        properties: {
          name: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          tips: { type: 'string' },
        },
      },
    },
    weatherAdvice: { type: 'string' },
  },
};

function isOutfitRecommendation(value: unknown): value is OutfitRecommendation {
  if (!isRecord(value)) return false;
  const recommendation = value;
  return (
    Array.isArray(recommendation.closetItems) &&
    recommendation.closetItems.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.category === 'string' &&
        typeof item.color === 'string' &&
        typeof item.description === 'string'
    ) &&
    Array.isArray(recommendation.outfits) &&
    recommendation.outfits.every(
      (outfit: unknown) =>
        isRecord(outfit) &&
        typeof outfit.name === 'string' &&
        Array.isArray(outfit.items) &&
        outfit.items.every((item: unknown) => typeof item === 'string') &&
        typeof outfit.reason === 'string' &&
        typeof outfit.tips === 'string'
    ) &&
    typeof recommendation.weatherAdvice === 'string'
  );
}

export async function recommendOutfits(
  image: Buffer,
  mimeType: string,
  weather: TodayWeather
): Promise<OutfitRecommendation> {
  const weatherSummary = [
    `지역: ${weather.location}`,
    `날짜: ${weather.date}`,
    `날씨: ${weather.description}`,
    `기온 범위: ${weather.minTemperature}~${weather.maxTemperature}${weather.temperatureUnit}`,
    `체감 기온 범위: ${weather.feelsLikeMin}~${weather.feelsLikeMax}${weather.temperatureUnit}`,
    `평균 습도: ${weather.humidity}%`,
    `최대 풍속: ${weather.maxWindSpeed} ${weather.windSpeedUnit}`,
    `강수 확률: ${weather.precipitationProbability}%`,
  ].join('\n');

  const recommendation = await requestStructuredImageAnalysis({
    image,
    mimeType,
    schemaName: 'outfit_recommendation',
    schema: recommendationSchema,
    systemPrompt:
      '당신은 한국어로 답하는 실용적인 스타일리스트입니다. 옷장 사진에서 확인되는 옷만 분석하고 추천에 사용하세요. 사진에서 확실히 확인할 수 없는 옷의 종류나 색상은 지어내지 말고, 정보가 부족하면 해당 옷장 항목을 비워 두세요. 제공된 오늘의 날씨에 맞춰 옷장에 있는 옷만으로 1~3가지 코디를 추천하세요. JSON 스키마에 맞는 내용만 반환하세요.',
    userPrompt: `오늘 날씨 정보입니다:\n${weatherSummary}\n\n옷장 사진을 분석하고 날씨에 맞는 코디를 추천해 주세요. 코디마다 사진에서 확인한 옷의 종류와 색상을 설명하고, 날씨에 적합한 이유 및 실용적인 팁을 포함하세요.`,
  });

  if (!isOutfitRecommendation(recommendation)) {
    throw new ModelApiError(502, 'Meta Model API returned an invalid recommendation');
  }

  return recommendation;
}
