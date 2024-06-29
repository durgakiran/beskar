import zapy.api
import store


print(store.store.get("client_secret"))

zapy.api.start_server()
