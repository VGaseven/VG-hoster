import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config';

@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) {
      const body = e.getResponse();
      return res.status(e.getStatus()).json(typeof body === 'string' ? { code: 'ERROR', message: body } : body);
    }
    console.error(e);
    res.status(500).json({ code: 'INTERNAL', message: 'حدث خطأ غير متوقع' });
  }
}

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalFilters(new ErrorFilter());
  app.setGlobalPrefix('api');
  app.enableCors({ origin: cfg.webOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.listen(cfg.port);
  console.log(`madar api on :${cfg.port} (maps: ${cfg.googleMapsApiKey ? 'google' : 'fallback'}, devLogin: ${cfg.devLogin})`);
}
bootstrap();
