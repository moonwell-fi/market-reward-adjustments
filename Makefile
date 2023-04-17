TAG := moonwell-market-adjustments

build-docker:
	docker build -t $(TAG) .

build:
	docker run --rm -it \
		-v $$(pwd):$$(pwd) \
		--workdir $$(pwd) \
		$(TAG) \
		npm run build --report

bash:
	docker run --rm -it \
		-v $$(pwd):$$(pwd) \
		--workdir $$(pwd) \
		$(TAG) \
		bash

vuepress:
	docker run --rm -it \
		-v $$(pwd):$$(pwd) \
		--workdir $$(pwd) \
		-p 8080:8080 \
		$(TAG) \
		npm run vuepress-dev