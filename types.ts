
export type Auth = {
  token: string;
  expires_at: number;
}

export type TokenPayload = {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number,
  token_type: string,
  "not-before-policy": number,
  scope: string
}
