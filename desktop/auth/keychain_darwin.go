//go:build darwin && cgo

package auth

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>
#include <string.h>

static CFStringRef text(const char *s) { return CFStringCreateWithCString(NULL,s,kCFStringEncodingUTF8); }
static OSStatus checkSigning(const char *identifier,const char *team,int production) {
 if (!production) return errSecSuccess;
 if (!team || !team[0]) return errSecAuthFailed;
 SecCodeRef code=NULL;CFDictionaryRef info=NULL;
 OSStatus status=SecCodeCopySelf(kSecCSDefaultFlags,&code);
 if(status==errSecSuccess) status=SecCodeCheckValidity(code,kSecCSStrictValidate,NULL);
 if(status==errSecSuccess) status=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info);
 CFStringRef expectedID=text(identifier),expectedTeam=text(team);
 if(status==errSecSuccess) {
  CFTypeRef actualID=CFDictionaryGetValue(info,kSecCodeInfoIdentifier);
  CFTypeRef actualTeam=CFDictionaryGetValue(info,kSecCodeInfoTeamIdentifier);
  if(!actualID || !actualTeam || !CFEqual(actualID,expectedID) || !CFEqual(actualTeam,expectedTeam)) status=errSecAuthFailed;
 }
 if(info) CFRelease(info);if(code) CFRelease(code);
 CFRelease(expectedID);CFRelease(expectedTeam);return status;
}
static CFMutableDictionaryRef queryFor(const char *service,const char *account) {
 CFMutableDictionaryRef q=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFStringRef s=text(service),a=text(account);
 CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);
 CFDictionarySetValue(q,kSecAttrService,s);CFDictionarySetValue(q,kSecAttrAccount,a);
 CFRelease(s);CFRelease(a);return q;
}
static OSStatus secretGet(const char *service,const char *account,void **bytes,size_t *length) {
 CFMutableDictionaryRef q=queryFor(service,account);
 CFDictionarySetValue(q,kSecReturnData,kCFBooleanTrue);
 CFDictionarySetValue(q,kSecMatchLimit,kSecMatchLimitOne);
 CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching(q,&result);
 if(status==errSecSuccess) {
  if(!result || CFGetTypeID(result)!=CFDataGetTypeID() || CFDataGetLength((CFDataRef)result)>2*1024*1024) status=errSecDecode;
  else { *length=(size_t)CFDataGetLength((CFDataRef)result);*bytes=malloc(*length ? *length : 1);if(!*bytes) status=errSecAllocate;else memcpy(*bytes,CFDataGetBytePtr((CFDataRef)result),*length); }
 }
 if(result) CFRelease(result);CFRelease(q);return status;
}
static OSStatus secretSet(const char *service,const char *account,const char *bytes,size_t length) {
 CFMutableDictionaryRef q=queryFor(service,account);
 CFDataRef data=CFDataCreate(NULL,(const UInt8 *)bytes,(CFIndex)length);
 CFMutableDictionaryRef update=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFDictionarySetValue(update,kSecValueData,data);
 OSStatus status=SecItemUpdate(q,update);
 if(status==errSecItemNotFound) {
  SecAccessRef access=NULL;CFStringRef label=text(service);
  // NULL trusted list means only the actual calling application, not the
  // /usr/bin/security subprocess used by the old backend.
  status=SecAccessCreate(label,NULL,&access);CFRelease(label);
  if(status==errSecSuccess) {
   CFDictionarySetValue(q,kSecValueData,data);CFDictionarySetValue(q,kSecAttrAccess,access);
   status=SecItemAdd(q,NULL);CFRelease(access);
  }
 }
 CFRelease(update);CFRelease(data);CFRelease(q);return status;
}
static OSStatus secretDelete(const char *service,const char *account) {
 CFMutableDictionaryRef q=queryFor(service,account);OSStatus status=SecItemDelete(q);CFRelease(q);return status;
}
static void clearSecret(void *bytes,size_t length) { if(bytes){ volatile unsigned char *p=bytes;while(length--) *p++=0;free(bytes); } }
*/
import "C"

import (
	"beskar/desktop/config"
	"errors"
	"github.com/zalando/go-keyring"
	"unsafe"
)

type platformSecrets struct{}

func nativeSecretBackend() secretBackend { return platformSecrets{} }
func checkNativeSigning() error {
	id, team := C.CString(config.ApplicationID), C.CString(config.ReleaseTeamID)
	defer C.free(unsafe.Pointer(id))
	defer C.free(unsafe.Pointer(team))
	production := C.int(0)
	if config.Environment == "production" {
		production = 1
	}
	if C.checkSigning(id, team, production) != C.errSecSuccess {
		return errCredentialAppIdentity
	}
	return nil
}
func nativeKeychainError(status C.OSStatus) error {
	if status == C.errSecSuccess {
		return nil
	}
	if status == C.errSecItemNotFound {
		return errCredentialsNotFound
	}
	return errors.New("native keychain operation failed")
}
func (platformSecrets) Get(service, account string) (string, error) {
	if err := checkNativeSigning(); err != nil {
		return "", err
	}
	s, a := C.CString(service), C.CString(account)
	defer C.free(unsafe.Pointer(s))
	defer C.free(unsafe.Pointer(a))
	var bytes unsafe.Pointer
	var length C.size_t
	status := C.secretGet(s, a, &bytes, &length)
	if err := nativeKeychainError(status); err != nil {
		return "", err
	}
	defer C.clearSecret(bytes, length)
	return string(C.GoBytes(bytes, C.int(length))), nil
}
func (platformSecrets) Set(service, account, value string) error {
	if err := checkNativeSigning(); err != nil {
		return err
	}
	s, a, v := C.CString(service), C.CString(account), C.CString(value)
	defer C.free(unsafe.Pointer(s))
	defer C.free(unsafe.Pointer(a))
	defer C.clearSecret(unsafe.Pointer(v), C.size_t(len(value)))
	return nativeKeychainError(C.secretSet(s, a, v, C.size_t(len(value))))
}
func (platformSecrets) Delete(service, account string) error {
	if err := checkNativeSigning(); err != nil {
		return err
	}
	// The old item was created by /usr/bin/security. Use its deletion-only
	// compatibility path; never read/import old data or create new items there.
	if service == legacyServiceName && account == legacyAccountName {
		return keyring.Delete(service, account)
	}
	s, a := C.CString(service), C.CString(account)
	defer C.free(unsafe.Pointer(s))
	defer C.free(unsafe.Pointer(a))
	return nativeKeychainError(C.secretDelete(s, a))
}
