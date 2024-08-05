//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"jbi/core"
	"syscall/js"
)

// var jsonData = `{
// 	"content": [
// 	  {
// 		"attrs": { "textAlign": "left", "parentId": 1, "orderId": 0, "contentId": 2, "docId": 1 },
// 		"content": [{ "text": "This is first document", "type": "text", "attrs": { "parentId": 2, "orderId": 0, "contentId": 3, "docId": 1 } }],
// 		"type": "paragraph"
// 	  },
// 	  { "attrs": { "textAlign": "left", "parentId": 1, "orderId": 1, "contentId": 4, "docId": 1}, "type": "paragraph" }
// 	],
// 	"type": "doc",
// 	"attrs": { "orderId": 0, "contentId": 1, "docId": 1 }
//   }`

// const dbData = `[
//     { "type": "doc",  "orderId": 0, "contentId": 1, "docId": 1 },
//     { "type": "paragraph", "attrs": { "textAlign": "left"  }, "parentId": 1, "orderId": 0, "contentId": 2, "docId": 1  },
//     { "type": "text", "text": "This is first document", "parentId": 2, "orderId": 0, "contentId": 3, "docId": 1 },
//     { "type": "paragraph", "attrs": { "textAlign": "left"  }, "parentId": 1, "orderId": 1, "contentId": 4, "docId": 1  }
// ]`

// The `run` function returns a new JavaScript function
// that wraps the Go function.
func run() js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		fmt.Println(this)

		// t will be used to store unmarshaled JSON data.
		var t core.EditorDocument

		// unmarshall the first argument
		err := json.Unmarshal([]byte(args[0].String()), &t)

		if err != nil {
			return js.ValueOf([]interface{}{"invalid JSON"})
		}

		content := t.Data.ConvertToContentObjects(t.Id)

		output := core.OutputDocument{
			Id:     t.Id,
			PageId: t.PageId,
			Data:   content,
		}

		marshalledOutput, err := json.Marshal(&output)

		if err != nil {
			fmt.Println("Error in marshalling output")
			return js.ValueOf([]interface{}{"error in marshalled output"})
		}

		// UTF-8 string
		return js.ValueOf(string(marshalledOutput[:]))
	})
}

func editorDoc() js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		var t core.Doc

		err := json.Unmarshal([]byte(args[0].String()), &t)
		if err != nil {
			return js.ValueOf([]interface{}{"Invalid JSON"})
		}
		doc := t.CreateEditorDocument()
		marshalledOutput, err := json.Marshal(&doc)
		return js.ValueOf(string(marshalledOutput[:]))
	})
}

func Add(a int, b int) int {
	return a + b
}

func main() {
	// var data core.Document
	// var dbInputData []core.ContentNode
	// err := json.Unmarshal([]byte(jsonData), &data)
	// if err != nil {
	// 	fmt.Println(err)
	// 	os.Exit(1)
	// }
	// err = json.Unmarshal([]byte(dbData), &dbInputData)
	// if err != nil {
	// 	fmt.Println(err)
	// 	os.Exit(1)
	// }
	// sDocument := core.TraveseDBDoc(dbInputData)
	// sDocument.ValidateDocument(data)
	fmt.Println("Go web assembly")
	// Instantiate a channel, 'ch', with no buffer, acting as a synchronization point for the goroutine.
	ch := make(chan struct{}, 0)

	// Attach the previously defined 'run' function to the global JavaScript object,
	// making it callable from the JavaScript environment.
	js.Global().Set("run", run())
	js.Global().Set("getDoc", editorDoc())

	// Utilize a channel receive expression to halt the 'main' goroutine, preventing the program from terminating.
	<-ch
}
