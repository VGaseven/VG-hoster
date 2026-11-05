import { Controller, Get, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule, Cron, CronExpression } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, CONFIG, loadConfig } from './config';
import { DB, Db } from './db/db';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard, Public } from './auth/guard';
import { SlotsService } from './slots/slots.service';
import { BookingsService } from './bookings/bookings.service';
import { EmployeeController } from './bookings/employee.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { AdminController } from './dashboard/admin.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { RemindersService, WebhookNotifier } from './reminders/reminders.service';
import { TripsService } from './routes/trips.service';
import { FallbackEstimator, TripEstimator } from './routes/estimator';
import { GoogleRoutesEstimator } from './routes/google-routes';

export const ESTIMATOR = Symbol('ESTIMATOR');

@Controller('health')
class HealthController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) private readonly cfg: AppConfig) {}
  @Public()
  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { ok: true, maps: this.cfg.googleMapsApiKey ? 'google' : 'fallback' };
  }
}

/** المهام الخلفية: التذكيرات وتنظيف ذاكرة التقديرات */
@Injectable()
class Jobs {
  constructor(@Inject(RemindersService) private readonly reminders: RemindersService) {}
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatch() {
    if (process.env.JOBS_DISABLED === 'true') return;
    await this.reminders.dispatchDue().catch((e) => console.error('[jobs] reminders', e));
  }
  @Cron(CronExpression.EVERY_10_MINUTES)
  async purge() {
    if (process.env.JOBS_DISABLED === 'true') return;
    await this.reminders.purgeEstimates().catch((e) => console.error('[jobs] purge', e));
  }
}

@Injectable()
class DbLifecycle implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly db: Db) {}
  onModuleDestroy() {
    return this.db.close();
  }
}

@Module({
  imports: [ScheduleModule.forRoot(), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, AuthController, EmployeeController, AdminController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB, useFactory: (c: AppConfig) => new Db(c.databaseUrl), inject: [CONFIG] },
    {
      provide: ESTIMATOR,
      useFactory: (c: AppConfig, db: Db): TripEstimator =>
        c.googleMapsApiKey ? new GoogleRoutesEstimator(c.googleMapsApiKey, db, c.estimateCacheTtlMin) : new FallbackEstimator(),
      inject: [CONFIG, DB],
    },
    { provide: AuthService, useFactory: (db: Db, c: AppConfig) => new AuthService(db, c), inject: [DB, CONFIG] },
    { provide: SlotsService, useFactory: (db: Db) => new SlotsService(db), inject: [DB] },
    { provide: BookingsService, useFactory: (db: Db, s: SlotsService) => new BookingsService(db, s), inject: [DB, SlotsService] },
    { provide: TripsService, useFactory: (db: Db, e: TripEstimator) => new TripsService(db, e), inject: [DB, ESTIMATOR] },
    { provide: DashboardService, useFactory: (db: Db) => new DashboardService(db), inject: [DB] },
    { provide: IntegrationsService, useFactory: (db: Db) => new IntegrationsService(db), inject: [DB] },
    { provide: RemindersService, useFactory: (db: Db, c: AppConfig) => new RemindersService(db, new WebhookNotifier(c.reminderWebhookUrl)), inject: [DB, CONFIG] },
    Jobs,
    DbLifecycle,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
