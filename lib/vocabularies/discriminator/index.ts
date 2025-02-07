import {resolveRef} from "../../compile"
import type {CodeKeywordDefinition, AnySchemaObject, KeywordErrorDefinition} from "../../types"
import type {KeywordCxt} from "../../compile/validate"
import {_, getProperty, Name} from "../../compile/codegen"
import {DiscrError, DiscrErrorObj} from "../discriminator/types"
import MissingRefError from "../../compile/ref_error"
import { SchemaEnv } from "../../compile/index"
import { SchemaObject } from "../../types/index"

export type DiscriminatorError = DiscrErrorObj<DiscrError.Tag> | DiscrErrorObj<DiscrError.Mapping>

const error: KeywordErrorDefinition = {
  message: ({params: {discrError, tagName}}) =>
    discrError === DiscrError.Tag
      ? `tag "${tagName}" must be string`
      : `value of tag "${tagName}" must be in oneOf`,
  params: ({params: {discrError, tag, tagName}}) =>
    _`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`,
}

const def: CodeKeywordDefinition = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error,
  code(cxt: KeywordCxt) {
    const {gen, data, schema, parentSchema, it} = cxt
    const {oneOf} = parentSchema
    if (!it.opts.discriminator) {
      throw new Error("discriminator: requires discriminator option")
    }
    const tagName = schema.propertyName
    if (typeof tagName != "string") throw new Error("discriminator: requires propertyName")
    if (schema.mapping) throw new Error("discriminator: mapping is not supported")
    if (!oneOf) throw new Error("discriminator: requires oneOf keyword")
    const valid = gen.let("valid", false)
    const tag = gen.const("tag", _`${data}${getProperty(tagName)}`)
    gen.if(
      _`typeof ${tag} == "string"`,
      () => validateMapping(),
      () => cxt.error(false, {discrError: DiscrError.Tag, tag, tagName})
    )
    cxt.ok(valid)

    function validateMapping(): void {
      const mapping = getMapping()
      gen.if(false)
      for (const tagValue in mapping) {
        gen.elseIf(_`${tag} === ${tagValue}`)
        gen.assign(valid, applyTagSchema(mapping[tagValue]))
      }
      gen.else()
      cxt.error(false, {discrError: DiscrError.Mapping, tag, tagName})
      gen.endIf()
    }

    function applyTagSchema(schemaProp?: number): Name {
      const _valid = gen.name("valid")
      const schCxt = cxt.subschema({keyword: "oneOf", schemaProp}, _valid)
      cxt.mergeEvaluated(schCxt, Name)
      return _valid
    }

    function getMapping(): {[T in string]?: number} {
      const oneOfMapping: {[T in string]?: number} = {}
      const topRequired = hasRequired(parentSchema)
      let tagRequired = true
      for (let i = 0; i < oneOf.length; i++) {
        const sch = oneOf[i]

        if (sch.properties) {
          resolveTagName(sch, i)
          continue
        }


        if(sch.$ref) {
          const {baseId, schemaEnv: env, self} = it
          const {root} = env
          const resolved = resolveRef.call(self, root, baseId, sch.$ref)
          if (resolved === undefined) throw new MissingRefError(baseId, sch.$ref)

          if (resolved instanceof SchemaEnv) {
            resolveTagName(resolved.schema as SchemaObject, i)
          } else {
            resolveTagName(resolved as SchemaObject, i)
          }
          continue
        }

        
        throw new Error(
          `discriminator: oneOf schemas must define properties/${tagName}`
        )
      }
      if (!tagRequired) throw new Error(`discriminator: "${tagName}" must be required`)
      return oneOfMapping

      function hasRequired({required}: AnySchemaObject): boolean {
        return Array.isArray(required) && required.includes(tagName)
      }

      function resolveTagName(sch: AnySchemaObject, i: number): void {
        const propSch = sch.properties?.[tagName]
        if (typeof propSch != "object") {
          throw new Error(`discriminator: oneOf schemas must have "properties/${tagName}"`)
        }
        tagRequired = tagRequired && (topRequired || hasRequired(sch))
        addMappings(propSch, i)
      }

      function addMappings(sch: AnySchemaObject, i: number): void {
        if (sch.const) {
          addMapping(sch.const, i)
        } else if (sch.enum) {
          for (const tagValue of sch.enum) {
            addMapping(tagValue, i)
          }
        } else {
          throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`)
        }
      }

      function addMapping(tagValue: unknown, i: number): void {
        if (typeof tagValue != "string" || tagValue in oneOfMapping) {
          throw new Error(`discriminator: "${tagName}" values must be unique strings`)
        }
        oneOfMapping[tagValue] = i
      }
    }
  },
}

export default def
