export type TodayWeather = {
  location: string;
  date: string;
  description: string;
  minTemperature: number;
  maxTemperature: number;
  feelsLikeMin: number;
  feelsLikeMax: number;
  humidity: number;
  maxWindSpeed: number;
  precipitationProbability: number;
  temperatureUnit: '°C' | '°F' | 'K';
  windSpeedUnit: 'm/s' | 'mph';
};

type WeatherForecastItem = {
  dt: number;
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
  };
  weather: Array<{ description: string }>;
  wind: { speed: number };
  pop?: number;
};

type WeatherForecastResponse = {
  city: { name: string; timezone: number };
  list: WeatherForecastItem[];
};

type HttpError = Error & { statusCode?: number };

function createHttpError(statusCode: number, message: string): HttpError {
  const error: HttpError = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getUnits(): 'metric' | 'imperial' | 'standard' {
  const units = process.env.OPENWEATHER_UNITS || 'metric';
  if (units !== 'metric' && units !== 'imperial' && units !== 'standard') {
    throw createHttpError(500, 'OPENWEATHER_UNITS must be metric, imperial, or standard');
  }
  return units;
}

function getLocalDate(timestamp: number, timezoneOffset: number): string {
  return new Date((timestamp + timezoneOffset) * 1000).toISOString().slice(0, 10);
}

export async function getTodayWeather(latitude: number, longitude: number): Promise<TodayWeather> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw createHttpError(503, 'Weather service is not configured');
  }

  const units = getUnits();
  const url = new URL('https://api.openweathermap.org/data/2.5/forecast');
  url.search = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    appid: apiKey,
    units,
    lang: process.env.OPENWEATHER_LANG || 'kr',
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw createHttpError(504, 'Weather service timed out');
    }
    throw createHttpError(502, 'Could not reach the weather service');
  }

  if (!response.ok) {
    let providerMessage: string | undefined;
    try {
      const errorBody: unknown = await response.json();
      if (
        errorBody !== null &&
        typeof errorBody === 'object' &&
        'message' in errorBody &&
        typeof errorBody.message === 'string'
      ) {
        providerMessage = errorBody.message;
      }
    } catch {
      providerMessage = undefined;
    }

    if (response.status === 401) {
      throw createHttpError(503, 'Weather API key is invalid or inactive');
    }
    if (response.status === 404) {
      throw createHttpError(
        502,
        providerMessage
          ? `Weather service could not find this location: ${providerMessage}`
          : 'Weather service could not find this location'
      );
    }
    throw createHttpError(
      502,
      providerMessage
        ? `Weather service returned HTTP ${response.status}: ${providerMessage}`
        : `Weather service returned HTTP ${response.status}`
    );
  }

  let forecast: WeatherForecastResponse;
  try {
    forecast = (await response.json()) as WeatherForecastResponse;
  } catch {
    throw createHttpError(502, 'Weather service returned invalid data');
  }

  const today = getLocalDate(Date.now() / 1000, forecast.city.timezone);
  const todayForecast = forecast.list.filter((item) => getLocalDate(item.dt, forecast.city.timezone) === today);

  if (todayForecast.length === 0) {
    throw createHttpError(502, 'Weather service returned no forecast for today');
  }

  const temperatures = todayForecast.map((item) => item.main.temp);
  const feelsLikeTemperatures = todayForecast.map((item) => item.main.feels_like);
  const descriptions = new Map<string, number>();
  for (const item of todayForecast) {
    const description = item.weather[0]?.description;
    if (description) descriptions.set(description, (descriptions.get(description) ?? 0) + 1);
  }

  const description =
    [...descriptions.entries()].sort((first, second) => second[1] - first[1])[0]?.[0] ?? '날씨 정보 없음';

  return {
    location: forecast.city.name,
    date: today,
    description,
    minTemperature: Math.min(...temperatures),
    maxTemperature: Math.max(...temperatures),
    feelsLikeMin: Math.min(...feelsLikeTemperatures),
    feelsLikeMax: Math.max(...feelsLikeTemperatures),
    humidity: Math.round(todayForecast.reduce((sum, item) => sum + item.main.humidity, 0) / todayForecast.length),
    maxWindSpeed: Math.max(...todayForecast.map((item) => item.wind.speed)),
    precipitationProbability: Math.round(Math.max(...todayForecast.map((item) => item.pop ?? 0)) * 100),
    temperatureUnit: units === 'imperial' ? '°F' : units === 'standard' ? 'K' : '°C',
    windSpeedUnit: units === 'imperial' ? 'mph' : 'm/s',
  };
}
