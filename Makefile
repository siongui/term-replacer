# cannot use relative path in GOROOT, otherwise 6g not found. For example,
#   export GOROOT=../go  (=> 6g not found)
# it is also not allowed to use relative path in GOPATH
export GOROOT=$(realpath ../go1.12.9)
export GOPATH=$(realpath .)
export PATH := $(GOROOT)/bin:$(GOPATH)/bin:$(PATH)

WEBSITE_DIR=website
ZIPFILE=$(WEBSITE_DIR)/extension.zip

build: fmt
	@echo "\033[92mCompiling Go to JavaScript ...\033[0m"
	gopherjs build extension/click.go -o extension/click.js
	gopherjs build extension/data.go extension/cc.go -o extension/cc.js

pack:
	[ -d $(WEBSITE_DIR) ] || mkdir -p $(WEBSITE_DIR)
	cp extension/cc.js* $(WEBSITE_DIR)
	cp extension/click.js* $(WEBSITE_DIR)
	cp extension/manifest.json $(WEBSITE_DIR)
	cp extension/options.html $(WEBSITE_DIR)
	cd $(WEBSITE_DIR); zip -r extension.zip .

tool: fmt
	@echo "\033[92mParse CSV ...\033[0m"
	go run tool/csvparse.go

fmt:
	@echo "\033[92mGo fmt source code...\033[0m"
	@go fmt extension/*.go
	@go fmt tool/*.go

install:
	@echo "\033[92mInstalling GopherJS ...\033[0m"
	go get -u github.com/gopherjs/gopherjs
	@echo "\033[92mInstalling GopherJS Bindings for Chrome ...\033[0m"
	go get -u github.com/fabioberger/chrome
	@echo "\033[92mInstalling github.com/siongui/godom ...\033[0m"
	go get -u github.com/siongui/godom

clean:
	rm extension/*.js
	rm extension/*.js.map
