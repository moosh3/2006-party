import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * SECURITY: Session secret validation
 * - In production: MUST have SESSION_SECRET configured (32+ characters)
 * - In development: Allow fallback with warning
 */
function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: SESSION_SECRET environment variable is required in production');
    }
    console.warn('⚠️ Using insecure fallback SESSION_SECRET in development mode');
    console.warn('⚠️ Set SESSION_SECRET in .env.local for secure sessions');
    return new TextEncoder().encode('dev-only-insecure-secret-do-not-use-in-production');
  }
  
  // Validate secret length (minimum 32 characters for security)
  if (secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: SESSION_SECRET must be at least 32 characters long');
    }
    console.warn('⚠️ SESSION_SECRET should be at least 32 characters for security');
  }
  
  return new TextEncoder().encode(secret);
}

export interface AdminSessionData {
  userId: string;
  role: 'admin';
  createdAt: number;
  expiresAt: number;
}

export interface SessionData {
  userId: string;
  role: 'admin' | 'viewer';
}

export async function createAdminSession(userId: string = 'admin'): Promise<string> {
  const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8 hours
  
  const sessionData: AdminSessionData = {
    userId,
    role: 'admin',
    createdAt: Date.now(),
    expiresAt,
  };

  const token = await new SignJWT({ ...sessionData })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(new Date(expiresAt))
    .sign(getSessionSecret());

  return token;
}

export async function verifyAdminSession(token: string): Promise<AdminSessionData | null> {
  try {
    const verified = await jwtVerify(token, getSessionSecret());
    return verified.payload as unknown as AdminSessionData;
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<AdminSessionData | null> {
  const cookieStore = cookies();
  const token = cookieStore.get('admin_session')?.value;
  
  if (!token) return null;
  
  return verifyAdminSession(token);
}

export function setAdminSessionCookie(response: NextResponse, token: string) {
  response.cookies.set('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60, // 8 hours in seconds
    path: '/',
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.delete('admin_session');
}

// General session getter that works for both admin and viewer contexts
export async function getSession(): Promise<SessionData | null> {
  // Try to get admin session first
  const adminSession = await getAdminSession();
  if (adminSession) {
    return {
      userId: adminSession.userId,
      role: 'admin',
    };
  }
  
  // For viewers, we rely on client-side localStorage
  // The API endpoints will accept userId from request body
  return null;
}
