import { NextResponse } from 'next/server';
import { testS3Connection } from 'lib/s3';

export async function GET() {
  try {
    console.log('Testing S3 connection...');
    const isConnected = await testS3Connection();
    
    if (isConnected) {
      return NextResponse.json({ 
        success: true, 
        message: "✅ S3 connected successfully!" 
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        message: "❌ S3 connection failed - check logs" 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Test endpoint error:', error);
    return NextResponse.json({ 
      success: false, 
      message: "❌ Error testing S3",
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
