export const WEBHOOK_EVENTS = [
  'booking.confirmed',
  'booking.rescheduled',
  'booking.canceled',
  'booking.checked_in',
  'booking.completed',
  'booking.no_show',
  'payment.link_created',
  'payment.paid',
  'customer.registered',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
