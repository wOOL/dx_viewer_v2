import { AuthService } from '@be-certain/core/auth';
import { SubscriptionService } from '@be-certain/core/subscription';
import { pb } from './pocketbase';

export const auth = new AuthService(pb);
export const subscription = new SubscriptionService(pb);
