/**
 * Phase 25: seeds the real plan catalog (FREE/STARTER/PRO/BUSINESS) into
 * `SubscriptionPlan` — a model that has existed in the schema since the
 * earlier architecture phases but was never seeded or wired into any
 * application code until this phase. Entitlement numbers below are a
 * pricing-experiment input, not validated final numbers (same honesty
 * standard as workspace.service.ts's prior FREE_TIER_STARTER_CREDITS
 * comment) — the architectural point is that they live in ONE place and
 * every check reads from here, not that these exact figures are final.
 *
 * Idempotent: safe to re-run (upserts by unique `key`).
 *
 *   npx tsx src/scripts/seed-subscription-plans.ts
 */
import { prisma } from '../infrastructure/database/prisma';
import type { Prisma } from '@prisma/client';

export interface PlanFeatureMatrix {
  advancedAnalytics: boolean;
  apiAccess: boolean;
  priorityProcessing: boolean;
  export: boolean;
  customIntegrations: boolean;
}

interface PlanSeedDefinition {
  key: string;
  tier: 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS';
  name: string;
  description: string;
  priceMonthlyCents: number | null;
  priceAnnualCents: number | null;
  aiCreditsPerMonth: number;
  maxWorkspaces: number | null;
  maxTeamSeats: number | null;
  maxBusinessProfiles: number | null;
  maxActiveProjects: number | null;
  historyRetentionDays: number;
  featureMatrix: PlanFeatureMatrix;
  sortOrder: number;
}

export const PLAN_DEFINITIONS: readonly PlanSeedDefinition[] = [
  {
    key: 'free',
    tier: 'FREE',
    name: 'Free',
    description: 'Get started with core AI workflows at no cost.',
    priceMonthlyCents: 0,
    priceAnnualCents: 0,
    aiCreditsPerMonth: 100,
    maxWorkspaces: 1,
    maxTeamSeats: 1,
    maxBusinessProfiles: 1,
    maxActiveProjects: 3,
    historyRetentionDays: 30,
    featureMatrix: { advancedAnalytics: false, apiAccess: false, priorityProcessing: false, export: false, customIntegrations: false },
    sortOrder: 0,
  },
  {
    key: 'starter',
    tier: 'STARTER',
    name: 'Starter',
    description: 'For small teams ready to grow with AI-driven marketing.',
    priceMonthlyCents: 2900,
    priceAnnualCents: 29000,
    aiCreditsPerMonth: 500,
    maxWorkspaces: 1,
    maxTeamSeats: 3,
    maxBusinessProfiles: 3,
    maxActiveProjects: 10,
    historyRetentionDays: 90,
    featureMatrix: { advancedAnalytics: false, apiAccess: false, priorityProcessing: false, export: true, customIntegrations: false },
    sortOrder: 1,
  },
  {
    key: 'pro',
    tier: 'PRO',
    name: 'Pro',
    description: 'Advanced analytics and priority processing for growing businesses.',
    priceMonthlyCents: 9900,
    priceAnnualCents: 99000,
    aiCreditsPerMonth: 2000,
    maxWorkspaces: 3,
    maxTeamSeats: 10,
    maxBusinessProfiles: 10,
    maxActiveProjects: 50,
    historyRetentionDays: 365,
    featureMatrix: { advancedAnalytics: true, apiAccess: true, priorityProcessing: true, export: true, customIntegrations: false },
    sortOrder: 2,
  },
  {
    key: 'business',
    tier: 'BUSINESS',
    name: 'Business',
    description: 'Unlimited scale with custom integrations for larger organizations.',
    priceMonthlyCents: 29900,
    priceAnnualCents: 299000,
    aiCreditsPerMonth: 10000,
    maxWorkspaces: null,
    maxTeamSeats: null,
    maxBusinessProfiles: null,
    maxActiveProjects: null,
    historyRetentionDays: 730,
    featureMatrix: { advancedAnalytics: true, apiAccess: true, priorityProcessing: true, export: true, customIntegrations: true },
    sortOrder: 3,
  },
];

export async function seedSubscriptionPlans(): Promise<void> {
  for (const plan of PLAN_DEFINITIONS) {
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      update: {
        tier: plan.tier,
        name: plan.name,
        description: plan.description,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceAnnualCents: plan.priceAnnualCents,
        aiCreditsPerMonth: plan.aiCreditsPerMonth,
        maxWorkspaces: plan.maxWorkspaces,
        maxTeamSeats: plan.maxTeamSeats,
        maxBusinessProfiles: plan.maxBusinessProfiles,
        maxActiveProjects: plan.maxActiveProjects,
        historyRetentionDays: plan.historyRetentionDays,
        featureMatrix: plan.featureMatrix as unknown as Prisma.InputJsonValue,
        isActive: true,
        sortOrder: plan.sortOrder,
      },
      create: {
        key: plan.key,
        tier: plan.tier,
        name: plan.name,
        description: plan.description,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceAnnualCents: plan.priceAnnualCents,
        aiCreditsPerMonth: plan.aiCreditsPerMonth,
        maxWorkspaces: plan.maxWorkspaces,
        maxTeamSeats: plan.maxTeamSeats,
        maxBusinessProfiles: plan.maxBusinessProfiles,
        maxActiveProjects: plan.maxActiveProjects,
        historyRetentionDays: plan.historyRetentionDays,
        featureMatrix: plan.featureMatrix as unknown as Prisma.InputJsonValue,
        sortOrder: plan.sortOrder,
      },
    });

    console.log(`Seeded plan ${plan.key} (${plan.tier}).`);
  }
}

if (require.main === module) {
  seedSubscriptionPlans()
    .then(() => {
      console.log('Subscription plan seed complete.');
      return prisma.$disconnect();
    })
    .catch(async (err: unknown) => {
      console.error('Subscription plan seed failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
