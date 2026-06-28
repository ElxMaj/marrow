# Notes: billing webhooks

Payments come in through the provider's webhooks. The provider retries on its own schedule, so we sometimes get the same event twice, and occasionally out of order.

We decided billing webhooks retry with backoff on our side too, and every handler is idempotent keyed on the event id, so a duplicate delivery is a no-op rather than a double charge. We log every received event before processing so a dropped webhook is recoverable.

We have not decided what to do about a provider outage longer than our retry window; that stays an open question.
