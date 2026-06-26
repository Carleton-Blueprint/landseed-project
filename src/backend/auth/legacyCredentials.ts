import { prisma } from "lib/prisma";

type LegacyCredentials = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
};

export async function authorizeLegacyCredentials(credentials: LegacyCredentials) {
  const name = typeof credentials.name === "string" ? credentials.name.trim() : "";
  const email =
    typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const phone = typeof credentials.phone === "string" ? credentials.phone.trim() : null;

  if (!name || !email) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (user) {
    return {
      id: user.id,
      name: user.name ?? name,
      email: user.email,
      image: user.image || null,
    };
  }

  if (process.env.NODE_ENV === "development") {
    const created = await prisma.user.create({
      data: { name, email, phone: phone || null },
    });
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      image: null,
    };
  }

  return null;
}
