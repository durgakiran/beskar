package main

import "testing"

func TestDocumentRoomsHaveNoSaveLeader(t *testing.T) {
	h := newHub()
	topic := "document-v2:space:42"
	client := &Client{clientID: "a", send: make(chan []byte, 1)}
	h.topics[topic] = map[*Client]bool{client: true}
	h.electLeaderInternal(topic, nil)
	h.electLeaderInternal(topic, client)
	if _, exists := h.topicLeaderID[topic]; exists {
		t.Fatal("document room elected a leader")
	}
	if len(client.send) != 0 {
		t.Fatal("document room sent leader messages")
	}
}
