import faker from "faker";

import { Prisma } from "@prisma/client";
import * as prismaNestedMiddleware from "../src";
import { createParams } from "./utils/createParams";

describe("custom-client", () => {
  it("accepts custom Prisma client via prior call to init()", async () => {
    const initSpy = jest.spyOn(prismaNestedMiddleware, "init");

    prismaNestedMiddleware.init(Prisma);

    const middleware = jest.fn((params, next) => next(params));
    const nestedMiddleware = prismaNestedMiddleware.createNestedMiddleware(middleware);

    const next = jest.fn((params: any) => params);
    const params = createParams("User", "create", {
    data: { email: faker.internet.email() },
    });
    await nestedMiddleware(params, next);

    // middleware is called with params and next
    expect(middleware).toHaveBeenCalledTimes(1);
    expect(middleware).toHaveBeenCalledWith(params, next);

    // init() only called once
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
