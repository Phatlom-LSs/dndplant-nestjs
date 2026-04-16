import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { NextFunction, Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.use(cookieParser());

  const FRONT_ORIGIN = [
    process.env.PROD_FETCH_API,
    process.env.DEV_FETCH_API,
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: (origin: string | undefined, callback) => {
      if (!origin) return callback(null, true);
      if (FRONT_ORIGIN.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.header(
        'Access-Control-Allow-Methods',
        'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      );
      res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      return res.sendStatus(204);
    }
    next();
  });
  await app.listen(process.env.PORT || 4000);
}
void bootstrap();
