import { AppError } from '../../common/errors/app-error';
import type { TenantAuthContext } from '../auth/auth.types';

export function assertCanManageBooking(auth: TenantAuthContext, staffUserId: string | null) {
  if (auth.permissions.includes('bookings.manage.any')) {
    return;
  }
  if (auth.permissions.includes('bookings.manage.own') && staffUserId === auth.userId) {
    return;
  }
  throw AppError.forbidden('PERMISSION_DENIED', 'You cannot manage bookings for this barber');
}

export function assertCanViewBooking(auth: TenantAuthContext, staffUserId: string | null) {
  if (
    auth.permissions.includes('bookings.view.any') ||
    auth.permissions.includes('bookings.manage.any')
  ) {
    return;
  }
  if (
    (auth.permissions.includes('bookings.view.own') ||
      auth.permissions.includes('bookings.manage.own')) &&
    staffUserId === auth.userId
  ) {
    return;
  }
  throw AppError.notFound('BOOKING_NOT_FOUND', 'Booking not found');
}
