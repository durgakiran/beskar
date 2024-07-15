package core

import "github.com/google/uuid"

func (q *Queue) Enqueue(v Document, order int64, parent uuid.UUID) {
	node := QueueNode{value: v, Order: order, Parent: parent}

	if q.back == nil {
		q.front = &node
		q.back = &node
		return
	}
	q.back.next = &node
	q.back = &node
}

func (q *Queue) Empty() bool {
	return q.front == nil
}

func (q *Queue) Dequeue() *QueueNode {
	if q.Empty() {
		return nil
	}
	temp := q.front
	q.front = q.front.next
	if q.front == nil {
		q.back = nil
	}
	return temp
}
