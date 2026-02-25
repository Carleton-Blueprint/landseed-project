import { NextResponse } from 'next/server';
import { prisma } from 'lib/prisma'; // prisma client

// Handle GET requests
// export async function GET(request) {
//   // Logic for handling GET requests
//   return NextResponse.json({ message: 'Hello from GET!' });
// }

// Handle POST requests
export async function POST(request: Request) {
  // Logic for handling POST requests
  try {
    // 1. Parse the incoming data
    const data = await request.json();
    const { name, email, phone } = data;

    // 2. Create a new user in the database
    const user = await prisma.user.create({
      data: {
        name: name,
        email: email || null,  // Optional field
        phone: phone || null,  // Optional field
      }
    });

    // 3. Return success response
    return NextResponse.json({ 
      success: true, 
      user: user 
    });

  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create user' },
      { status: 500 }
    );
  }
}
