import { HttpException, HttpStatus } from '@nestjs/common';

/** خطأ عمل برمز ثابت ورسالة عربية مفهومة للموظف */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}
