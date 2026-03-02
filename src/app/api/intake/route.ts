import { NextResponse } from 'next/server';
import { prisma } from 'lib/prisma'; // prisma client

// Handle POST requests
export async function POST(request: Request) {
  // Logic for handling POST requests
  try {
    // Parse the incoming data
    const data = await request.json();
    const { name, email, phone } = data;

    // Create a new user in the database
    const user = await prisma.user.create({
      data: {
        name: name,
        email: email || null,  // Optional field
        phone: phone || null,  // Optional field
      }
    });

    // Return success response
    return NextResponse.json({ 
      success: true, 
      user: user 
    });

  } catch (error: unknown) {
    console.error("Database error:", error);

    // Prisma unique constraint (e.g. duplicate email)
    const prismaError = error as { code?: string; meta?: { target?: string[] } };
    if (prismaError?.code === "P2002") {
      const target = prismaError.meta?.target?.[0] ?? "field";
      return NextResponse.json(
        { success: false, error: `A user with this ${target} already exists.` },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create user",
      },
      { status: 500 }
    );
  }
}
