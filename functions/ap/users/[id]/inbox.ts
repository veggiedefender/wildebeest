import { parseHandle } from 'wildebeest/backend/src/utils/parse'
import { getVAPIDKeys } from 'wildebeest/backend/src/config'
import type { JWK } from 'wildebeest/backend/src/webpush/jwk'
import * as actors from 'wildebeest/backend/src/activitypub/actors'
import { actorURL } from 'wildebeest/backend/src/activitypub/actors'
import type { Env } from 'wildebeest/backend/src/types/env'
import type { MessageBody } from 'wildebeest/backend/src/types/queue'
import type { Activity } from 'wildebeest/backend/src/activitypub/activities'
import { parseRequest } from 'wildebeest/backend/src/utils/httpsigjs/parser'
import { fetchKey, verifySignature } from 'wildebeest/backend/src/utils/httpsigjs/verifier'
import { generateDigestHeader } from 'wildebeest/backend/src/utils/http-signing-cavage'

export const onRequest: PagesFunction<Env, any> = async ({ params, request, env }) => {
	const parsedSignature = parseRequest(request)
	const pubKey = await fetchKey(parsedSignature)
	const valid = await verifySignature(parsedSignature, pubKey)
	if (!valid) {
		return new Response('invalid signature', { status: 401 })
	}

	const body = await request.text()
	if (request.method == 'POST') {
		const digest = request.headers.get('digest')
		const generatedDigest = await generateDigestHeader(body)
		if (digest != generatedDigest) {
			return new Response('invalid digest', { status: 401 })
		}
	}

	const activity: Activity = JSON.parse(body)
	const domain = new URL(request.url).hostname
	return handleRequest(
		domain,
		env.DATABASE,
		params.id as string,
		activity,
		env.QUEUE,
		env.userKEK,
		getVAPIDKeys(env)
	)
}

export async function handleRequest(
	domain: string,
	db: D1Database,
	id: string,
	activity: Activity,
	queue: Queue<MessageBody>,
	userKEK: string,
	vapidKeys: JWK
): Promise<Response> {
	const handle = parseHandle(id)

	if (handle.domain !== null && handle.domain !== domain) {
		return new Response('', { status: 403 })
	}
	const actorId = actorURL(domain, handle.localPart)

	const actor = await actors.getPersonById(db, actorId)
	if (actor === null) {
		return new Response('', { status: 404 })
	}

	await queue.send({
		type: 'activity',
		actorId: actor.id.toString(),
		content: activity,
		userKEK,
		vapidKeys,
	})

	return new Response('', { status: 200 })
}
