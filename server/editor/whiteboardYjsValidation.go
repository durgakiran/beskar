package editor

import (
	"encoding/json"
	"errors"
	"unicode/utf8"
)

// This scanner validates the Yjs 13 update-v1 wire structure, without allocating
// CRDT objects or resolving references to previous batches. It deliberately does
// not validate drawing schema or causal completeness. Format references:
// https://github.com/yjs/yjs/blob/v13.6.27/src/utils/encoding.js
// https://github.com/yjs/yjs/blob/v13.6.27/src/utils/UpdateDecoder.js
// https://github.com/dmonad/lib0/blob/main/decoding.js
// Keep cross-language fixtures in testdata when extending supported formats.
const yjsMaxSafeInteger uint64 = 1<<53 - 1

var errInvalidYjsUpdate = errors.New("invalid Yjs update-v1")

type yjsWireReader struct {
	data []byte
	pos  int
	err  error
}

func (r *yjsWireReader) fail() { r.err = errInvalidYjsUpdate }
func (r *yjsWireReader) take(n uint64) []byte {
	if r.err != nil {
		return nil
	}
	if n > uint64(len(r.data)-r.pos) {
		r.fail()
		return nil
	}
	b := r.data[r.pos : r.pos+int(n)]
	r.pos += int(n)
	return b
}
func (r *yjsWireReader) byte() byte {
	b := r.take(1)
	if len(b) == 0 {
		return 0
	}
	return b[0]
}
func (r *yjsWireReader) uint() uint64 {
	var n uint64
	for shift := uint(0); shift <= 49 && r.err == nil; shift += 7 {
		b := r.byte()
		n |= uint64(b&127) << shift
		if n > yjsMaxSafeInteger {
			r.fail()
			return 0
		}
		if b&128 == 0 {
			return n
		}
	}
	r.fail()
	return 0
}
func (r *yjsWireReader) count() uint64 {
	n := r.uint()
	// Every counted entry consumes at least one byte. Never loop based solely
	// on an untrusted declared length.
	if n > uint64(len(r.data)-r.pos) {
		r.fail()
		return 0
	}
	return n
}
func (r *yjsWireReader) str() []byte {
	b := r.take(r.uint())
	if !utf8.Valid(b) {
		r.fail()
	}
	return b
}
func (r *yjsWireReader) id() { r.uint(); r.uint() }
func (r *yjsWireReader) json(allowUndefined bool) {
	b := r.str()
	if !(allowUndefined && string(b) == "undefined") && !json.Valid(b) {
		r.fail()
	}
}
func (r *yjsWireReader) any(depth int) {
	if r.err != nil {
		return
	}
	if depth > 64 {
		r.fail()
		return
	}
	switch r.byte() {
	case 127, 126, 121, 120: // undefined, null, booleans
	case 125: // signed varint: first byte has six value bits and one sign bit
		b := r.byte()
		n := uint64(b & 63)
		for shift := uint(6); b&128 != 0 && r.err == nil; shift += 7 {
			if shift > 48 {
				r.fail()
				return
			}
			b = r.byte()
			n |= uint64(b&127) << shift
			if n > yjsMaxSafeInteger {
				r.fail()
				return
			}
		}
	case 124:
		r.take(4)
	case 123, 122:
		r.take(8)
	case 119:
		r.str()
	case 118:
		for n := r.count(); n > 0 && r.err == nil; n-- {
			r.str()
			r.any(depth + 1)
		}
	case 117:
		for n := r.count(); n > 0 && r.err == nil; n-- {
			r.any(depth + 1)
		}
	case 116:
		r.take(r.uint())
	default:
		r.fail()
	}
}
func (r *yjsWireReader) content(tag byte) uint64 {
	switch tag {
	case 1:
		return r.uint() // deleted content
	case 2:
		n := r.count()
		for i := uint64(0); i < n && r.err == nil; i++ {
			r.json(true)
		}
		return n
	case 3:
		r.take(r.uint())
	case 4:
		// Yjs string clocks count UTF-16 code units, not UTF-8 bytes/runes.
		var n uint64
		for _, v := range string(r.str()) {
			n++
			if v > 0xffff {
				n++
			}
		}
		return n
	case 5:
		r.json(false)
	case 6:
		r.str()
		r.json(false)
	case 7:
		kind := r.uint()
		if kind > 6 {
			r.fail()
		}
		if kind == 3 || kind == 5 {
			r.str()
		} // XML element/hook name
	case 8:
		n := r.count()
		for i := uint64(0); i < n && r.err == nil; i++ {
			r.any(0)
		}
		return n
	case 9:
		r.str()
		r.any(0) // subdocument GUID/options
	default:
		r.fail()
	}
	return 1
}
func (r *yjsWireReader) structLength() uint64 {
	info := r.byte()
	tag := info & 31
	if tag == 0 || tag == 10 {
		return r.uint()
	} // GC / Skip
	if info&128 != 0 {
		r.id()
	}
	if info&64 != 0 {
		r.id()
	}
	if info&192 == 0 {
		switch r.uint() {
		case 0:
			r.id()
		case 1:
			r.str()
		default:
			r.fail()
		}
		if info&32 != 0 {
			r.str()
		}
	}
	return r.content(tag)
}
func validateYjsUpdateV1(data []byte) error {
	r := yjsWireReader{data: data}
	for clients := r.count(); clients > 0 && r.err == nil; clients-- {
		structs := r.count()
		r.uint() // client ID
		clock := r.uint()
		for ; structs > 0 && r.err == nil; structs-- {
			length := r.structLength()
			if length == 0 || length > yjsMaxSafeInteger-clock {
				r.fail()
				break
			}
			clock += length
		}
	}
	for clients := r.count(); clients > 0 && r.err == nil; clients-- {
		r.uint()
		for deletes := r.count(); deletes > 0 && r.err == nil; deletes-- {
			clock, length := r.uint(), r.uint()
			if length == 0 || length > yjsMaxSafeInteger-clock {
				r.fail()
			}
		}
	}
	if r.err != nil || r.pos != len(data) {
		return errInvalidYjsUpdate
	}
	return nil
}
