// Prints the teacher link once at startup, for opening the teacher screen in a new browser.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { teacherKey } = await import('./server/auth');
  const port = process.env.PORT || '3000';
  console.log(`\n  Classeum 선생님 링크 (이 노트북에서만): http://localhost:${port}/api/teacher/login?key=${teacherKey()}\n`);
}
