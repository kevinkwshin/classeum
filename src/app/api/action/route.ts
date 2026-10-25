import type { NextRequest } from 'next/server';
import { hashToken, hub } from '@/server/hub';
import { isTeacher } from '@/server/auth';

const TEACHER_ACTIONS = new Set([
  'approve', 'reject', 'approve-all', 'revoke', 'roster', 'remove-student', 'create-event', 'delete-event', 'reward', 'open-lobby', 'close-session', 'control',
]);

export async function POST(request: NextRequest) {
  // A JSON content type forces a CORS preflight, which this server never approves.
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 16_000) {
    return Response.json({ ok: false, error: '요청이 너무 커요.' }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 400 });
  }
  const type = String(body.type ?? '');
  const h = hub();
  try {
    if (TEACHER_ACTIONS.has(type)) {
      if (!isTeacher(request)) return Response.json({ ok: false, error: '노트북의 선생님 화면에서만 할 수 있어요.' }, { status: 403 });
      switch (type) {
        case 'approve':
          h.decideRequest(String(body.requestId), true);
          break;
        case 'reject':
          h.decideRequest(String(body.requestId), false);
          break;
        case 'approve-all':
          return Response.json({ ok: true, approved: h.approveAllSimple() });
        case 'revoke':
          h.revokeDevice(String(body.studentId));
          break;
        case 'roster':
          return Response.json({ ok: true, added: h.setRoster(String(body.text ?? '')) });
        case 'remove-student':
          h.removeStudent(String(body.studentId));
          break;
        case 'create-event':
          return Response.json({ ok: true, eventIds: h.createEvents(String(body.draftId)) });
        case 'delete-event':
          h.deleteEvent(String(body.eventId));
          break;
        case 'reward':
          h.setReward(String(body.eventId), String(body.itemId), Number(body.challengePct), Number(body.growthPp));
          break;
        case 'open-lobby':
          h.openLobby(String(body.eventId));
          break;
        case 'close-session':
          h.closeSession();
          break;
        case 'control':
          h.control(String(body.action));
          break;
      }
      return Response.json({ ok: true });
    }

    const token = String(body.token ?? '');
    if (token.length < 32) return Response.json({ ok: false, error: '기기 정보가 없어요.' }, { status: 400 });
    const tokenHash = hashToken(token);
    switch (type) {
      case 'register':
        h.requestRegistration(tokenHash, String(body.studentId));
        break;
      case 'cancel-register':
        h.cancelRegistration(tokenHash);
        break;
      case 'look':
        h.setLook(tokenHash, (body.look ?? {}) as Record<string, string>);
        break;
      case 'pos':
        h.move(tokenHash, Number(body.seq), { x: Number(body.x), y: Number(body.y) }, Number(body.n ?? NaN));
        break;
      case 'text':
        h.submitText(tokenHash, Number(body.seq), String(body.value ?? ''));
        break;
      case 'practice':
        h.recordPractice(tokenHash, String(body.questionId), Number(body.choice));
        break;
      default:
        return Response.json({ ok: false, error: '알 수 없는 요청이에요.' }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : '문제가 생겼어요.' }, { status: 400 });
  }
}
