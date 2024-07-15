package core

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

var jsonData = `{
	"content": [
	  {
		"attrs": { "textAlign": "left", "orderId": 0, "docId": 1 },
		"content": [{ "text": "This is first document", "type": "text", "attrs": { "orderId": 0, "docId": 1 } }],
		"type": "paragraph"
	  },
	  { "attrs": { "textAlign": "left", "orderId": 1,  "docId": 1}, "type": "paragraph" }
	],
	"type": "doc",
	"attrs": { "orderId": 0, "docId": 1 }
  }`

const tableData = `{
  "id": 7,
  "pageId": "7",
  "data": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {
          "textAlign": "left",
          "level": 3
        },
        "content": [
          {
            "type": "text",
            "text": "Columns"
          }
        ]
      },
      {
        "type": "table",
        "content": [
          {
            "type": "tableRow",
            "content": [
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    83
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "marks": [
                          {
                            "type": "bold"
                          }
                        ],
                        "text": "Name"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    127
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "marks": [
                          {
                            "type": "bold"
                          }
                        ],
                        "text": "Type"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    106
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "optional"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "Description"
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "type": "tableRow",
            "content": [
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    83
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "content"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    127
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "Array of docs"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    106
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "t"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "Array of json, which contains items like (type, content, attrs, marks). content may not contain another content array."
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "type": "tableRow",
            "content": [
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    83
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "type"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    127
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "string"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    106
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "f"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    }
                  }
                ]
              }
            ]
          },
          {
            "type": "tableRow",
            "content": [
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    83
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "attrs"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    127
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "json"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    106
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "t"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    }
                  }
                ]
              }
            ]
          },
          {
            "type": "tableRow",
            "content": [
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    83
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "marks"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    127
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "json array"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    106
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "t"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    }
                  }
                ]
              }
            ]
          },
          {
            "type": "tableRow",
            "content": [
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    83
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "text"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    127
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "string"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    106
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "t"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "actual input text"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "heading",
        "attrs": {
          "textAlign": "left",
          "level": 3
        },
        "content": [
          {
            "type": "text",
            "text": "Document table"
          }
        ]
      },
      {
        "type": "table",
        "content": [
          {
            "type": "tableRow",
            "content": [
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": [
                    83
                  ],
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    },
                    "content": [
                      {
                        "type": "text",
                        "text": "content"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    }
                  }
                ]
              },
              {
                "type": "tableCell",
                "attrs": {
                  "colspan": 1,
                  "rowspan": 1,
                  "colwidth": null,
                  "style": null
                },
                "content": [
                  {
                    "type": "paragraph",
                    "attrs": {
                      "textAlign": "left"
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}`

const originalData = `{
  "content": [
    {
      "attrs": { "textAlign": "left", "orderId": 0, "docId": 1, "contentId": "20c562a2-8e31-43d0-a94d-1e00653468a1" },
      "content": [
        {
          "text": "This is first document",
          "type": "text",
          "attrs": { "orderId": 0, "docId": 1, "contentId": "0df31691-c281-4745-b271-bf75b83629ae" }
        }
      ],
      "type": "paragraph"
    },
    {
      "attrs": { "textAlign": "left", "orderId": 1, "docId": 1, "contentId": "349c525f-ff3c-49cd-9e31-47b01753842f" },
      "content": [
        {
          "text": "This is first document",
          "type": "text",
          "attrs": { "orderId": 0, "docId": 1, "contentId": "eec8b8d4-b6a2-48bb-9742-66d9163e372c" }
        }
      ],
      "type": "paragraph"
    }
  ],
  "type": "doc",
  "attrs": { "orderId": 0, "docId": 1, "contentId" : "b17235d5-d932-45a6-acb3-a593411f2479"}
}`

const originalDataWrongContentId = `{
    "content": [
      {
        "attrs": { "textAlign": "left", "orderId": 0, "docId": 1, "contentId": "hello" },
        "content": [
          {
            "text": "This is first document",
            "type": "text",
            "attrs": { "orderId": 0, "docId": 1, "contentId": "0df31691-c281-4745-b271-bf75b83629ae" }
          }
        ],
        "type": "paragraph"
      }
    ],
    "type": "doc",
    "attrs": { "orderId": 0, "docId": 1, "contentId" : "b17235d5-d932-45a6-acb3-a593411f2479"}
  }`

const newData = `{
  "content": [
    {
      "attrs": { "textAlign": "left", "orderId": 0, "docId": 1, "contentId": "20c562a2-8e31-43d0-a94d-1e00653468a1" },
      "content": [
        {
          "text": "This is second document",
          "type": "text",
          "attrs": { "orderId": 0, "docId": 1, "contentId": "0df31691-c281-4745-b271-bf75b83629ae" }
        }
      ],
      "type": "paragraph"
    },
    {
      "attrs": { "textAlign": "left", "orderId": 1, "docId": 1 },
      "type": "paragraph"
    }
  ],
  "type": "doc",
  "attrs": { "orderId": 0, "docId": 1, "contentId" : "b17235d5-d932-45a6-acb3-a593411f2479"}
}`

func TestConvertToContentObjects(t *testing.T) {
	t.Run("Document object", func(t *testing.T) {
		doc := Document{}
		err := json.Unmarshal([]byte(jsonData), &doc)
		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}
		got := doc.ConvertToContentObjects(1)
		if len(got) != 4 {
			t.Errorf("didn't get enough content objects")
		}
	})

	t.Run("Shouldn't generate new content id if already exists", func(t *testing.T) {
		doc := Document{}
		err := json.Unmarshal([]byte(originalData), &doc)
		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}
		got := doc.ConvertToContentObjects(1)

		if len(got) != 5 {
			t.Errorf("Expected 3 objects. got %v", len(got))
		}

		for _, child := range got {
			if !(child.ContentId == uuid.MustParse("eec8b8d4-b6a2-48bb-9742-66d9163e372c") || child.ContentId == uuid.MustParse("349c525f-ff3c-49cd-9e31-47b01753842f") || child.ContentId == uuid.MustParse("b17235d5-d932-45a6-acb3-a593411f2479") || child.ContentId == uuid.MustParse("0df31691-c281-4745-b271-bf75b83629ae") || child.ContentId == uuid.MustParse("20c562a2-8e31-43d0-a94d-1e00653468a1")) {
				t.Errorf("didn't match the input UUID")
			}

			if child.ContentId == uuid.MustParse("20c562a2-8e31-43d0-a94d-1e00653468a1") {
				if child.ParentId != uuid.MustParse("b17235d5-d932-45a6-acb3-a593411f2479") {
					t.Errorf("didn't match the parent UUID")
				}
			}

			if child.ContentId == uuid.MustParse("0df31691-c281-4745-b271-bf75b83629ae") {
				if child.ParentId != uuid.MustParse("20c562a2-8e31-43d0-a94d-1e00653468a1") {
					t.Errorf("didn't match the parent UUID")
				}
			}
		}
	})

	t.Run("Should fail if wrong content type id is passed", func(t *testing.T) {
		doc := Document{}
		err := json.Unmarshal([]byte(originalDataWrongContentId), &doc)
		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}
		defer func() {
			if r := recover(); r == nil {
				t.Errorf("Should panic for wrong content id")
			}
		}()
		doc.ConvertToContentObjects(1)
	})

	t.Run("Editor Document object", func(t *testing.T) {
		doc := EditorDocument{}
		err := json.Unmarshal([]byte(tableData), &doc)
		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}
		got := doc.Data.ConvertToContentObjects(1)
		if len(got) != 90 {
			t.Errorf("didn't get enough content objects got %v", len(got))
		}
	})

	t.Run("Get changes to document", func(t *testing.T) {
		old := Document{}
		new := Document{}

		err := json.Unmarshal([]byte(originalData), &old)
		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}

		err = json.Unmarshal([]byte(newData), &new)

		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}
		oldEditorDocument := EditorDocument{Id: 1, PageId: "1", Data: old}
		newEditorDocument := EditorDocument{Id: 1, PageId: "1", Data: new}

		deleted, inserted, updated := oldEditorDocument.GetChanges(newEditorDocument)

		if len(inserted) != 1 {
			t.Errorf("Wrong number of inserted records, got %v", len(inserted))
		}

		if inserted[0].Type != "paragraph" && inserted[0].ParentId != uuid.MustParse("b17235d5-d932-45a6-acb3-a593411f2479") {
			t.Errorf("wrong record picked for inserted record. Got %v", inserted)
		}

		if len(updated) != 1 {
			t.Errorf("Wrong number of updated records, got %v", len(updated))
		}

		if updated[0].Text != "This is second document" {
			t.Errorf("Wrong record picked as updated. Got %v", updated)
		}

		if len(deleted) != 2 {
			t.Errorf("Wrong number of deleted records. Got %v", len(deleted))
		}
	})
}
