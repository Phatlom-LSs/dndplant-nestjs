import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { AuthPayloadDto } from './dto/login.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthControllers {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async sigup(@Body() dto: AuthPayloadDto) {
    await this.authService.signup(dto);
  }

  @Post('signin')
  async singin(@Body() dto: AuthPayloadDto, @Req() req, @Res() res) {
    await this.authService.signin(dto, req, res);
  }
}
