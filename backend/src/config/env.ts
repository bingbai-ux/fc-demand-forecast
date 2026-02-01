import dotenv from 'dotenv';
dotenv.config();

export const config = {
  smaregi: {
    contractId: process.env.SMAREGI_CONTRACT_ID!,
    clientId: process.env.SMAREGI_CLIENT_ID!,
    clientSecret: process.env.SMAREGI_CLIENT_SECRET!,
    accessToken: process.env.SMAREGI_ACCESS_TOKEN!,
    refreshToken: process.env.SMAREGI_REFRESH_TOKEN!,
  },
  supabase: {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
};
