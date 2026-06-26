import { prisma } from "lib/prisma";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/backend/auth/password";

type PasswordCredentials = {
  email?: unknown;
  password?: unknown;
};

export async function authorizePasswordCredentials(credentials: PasswordCredentials) {
  const email =
    typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";

  if (!email || !password) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      passwordHash: true,
    },
  });

  const hashToCompare = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordValid = await verifyPassword(password, hashToCompare);

  if (!user?.passwordHash || !passwordValid) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image || null,
  };
}
