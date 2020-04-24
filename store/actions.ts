import { optionLabel } from '@vue-storefront/core/modules/catalog/helpers/optionLabel';
import { currentStoreView } from '@vue-storefront/core/lib/multistore';
import { baseFilterProductsQuery } from '@vue-storefront/core/helpers';
import { quickSearchByQuery } from './../../../../core/lib/search';
import i18n from '@vue-storefront/i18n';
import rootStore from '@vue-storefront/core/store';
import { ActionTree } from 'vuex'
import * as types from './mutation-types'
import RootState from '@vue-storefront/core/types/RootState'
import WishlistState from '@vue-storefront/core/modules/wishlist/types/WishlistState'
import { StorageManager } from '@vue-storefront/core/lib/storage-manager'
import { Wishlist } from '../service/WishlistService'
import config from 'config'

function mergeProductWithChild(product: any, child: any) {
  let name
      if (product.clone_name) {
        name = product.clone_name
      } else {
        throw new Error('Indexer did not prepare product\'s name - ' + product.name)
      }
      return {
        ...product,
        ...child,
        ...(product && product.sku ? { parentSku: product.originalParentSku || product.sku.replace(new RegExp(`-${product.clone_color_id}$`), '') } : {}),
        name,
        product_option: {
          extension_attributes: {
            configurable_item_options: product.configurable_options.map(option => {
              return {
                option_id: option.attribute_id,
                option_value: child[option.attribute_code]
              }
            })
          }
        }
      }
}

export const actions: ActionTree<WishlistState, RootState> = {
  clear (context) {
    context.commit(types.WISH_DEL_ALL_ITEMS, [])
  },
  async load ({ commit, getters, dispatch }, force: boolean = false) {
    if (!force && getters.isWishlistLoaded) return
    commit(types.SET_WISHLIST_LOADED)

    const [storedItemsCache, storedItemsServer] = await Promise.all([
      dispatch('loadFromCache'),
      dispatch('loadFromServer')
    ])

    const storedItems = !!storedItemsServer && storedItemsServer.map(productFromServer => {
      // Find approporiate product in the cache
      const productFromCache = storedItemsCache.find(product => product.sku === productFromServer.sku) || {}
      return {
        ...productFromCache,
        ...productFromServer,
        fromServer: true
      }
    })
    commit(types.WISH_LOAD_WISH, !!storedItems ? storedItems : storedItemsCache)
  },
  loadFromCache () {
    const wishlistStorage = StorageManager.get('wishlist')
    return wishlistStorage.getItem('current-wishlist')
  },
  async loadFromServer ({ rootGetters }): Promise<Array<any>> {
    if (rootGetters['user/isLoggedIn']) {
      let { resultCode, result } = await Wishlist.Load(rootGetters['user/getToken'])
      if (resultCode !== 200) {
        rootStore.dispatch('notification/spawnNotification', {
          type: 'error',
          message: i18n.t("Couldn't load wishlist, sorry."),
          action1: { label: i18n.t('OK') }
        })
      } else {
        // 1. Obtain skus
        // 2. Fetch parents (not clones)
        // 3. Iterate over skus and merge parents with childs with adding extra clone attrs

        const simpleSkus = result.wishlist_items.filter(({ product }) => product.type_id == 'simple').map(({ product }) => product.sku)
        const bundleSkus = result.wishlist_items.filter(({ product }) => product.type_id == 'bundle').map(({ product }) => product.sku)

        const { storeCode } = currentStoreView()

        let parents, bundles
        if (simpleSkus.length > 0) {
          const simpeQuery = baseFilterProductsQuery(0, [], true).applyFilter({key: 'clone_of.keyword', value: {'in': simpleSkus}})
          parents = await quickSearchByQuery({
            query: simpeQuery,
            start: 0,
            size: 100,
            entityType: 'product',
            sort: '',
            storeCode: storeCode ? storeCode : null,
            excludeFields: null,
            includeFields: config.entities.productList.includeFields
          })
        }
        if (bundleSkus.length > 0) {
          const bundleQuery = baseFilterProductsQuery(0, [], true).applyFilter({key: 'sku', value: {'in': bundleSkus}})
          bundles = await quickSearchByQuery({
            query: bundleQuery,
            start: 0,
            size: 100,
            entityType: 'product',
            sort: '',
            storeCode: storeCode ? storeCode : null,
            excludeFields: null,
            includeFields: config.entities.productList.includeFields
          })
        }

        return result.wishlist_items.map(wishlistRecord => {

          if (wishlistRecord.product.type_id == 'bundle') {
            if (!bundles || !Array.isArray(bundles.items)) {
              return {
                ...wishlistRecord.product,
                item_id: wishlistRecord.item_id
              }
            }
            const corresponding = bundles.items.find(item => item.sku == wishlistRecord.product.sku)
            if (corresponding) {
              return {
                ...corresponding,
                item_id: wishlistRecord.item_id
              }
            }
          } else if (wishlistRecord.product.type_id == 'simple') {
            if (!parents || !Array.isArray(parents.items)) {
              return {
                ...wishlistRecord.product,
                item_id: wishlistRecord.item_id
              }
            }
            const corresponding = parents.items.find(item => item.clone_of == wishlistRecord.product.sku)
            if (corresponding) {
              return {
                ...mergeProductWithChild(corresponding, corresponding.configurable_children.find(child => {
                  let condition = true
                  if (child.color && corresponding.clone_color_id) {
                    condition = condition && child.color == corresponding.clone_color_id
                  }
                  if (child.size && corresponding.clone_size_id) {
                    condition = condition && child.size == corresponding.clone_size_id
                  }
                  return condition && corresponding.clone_of == child.sku
                })),
                item_id: wishlistRecord.item_id
              }
            }
          }

          return {
            ...wishlistRecord.product,
            item_id: wishlistRecord.item_id
          }

          // const parent = parents && parents.items && parents.items.find(parent =>
          //   parent.configurable_children
          //   && parent.configurable_children.some(children =>
          //     children.sku === wishlistRecord.product.sku
          //     && children.color === +parent.clone_color_id
          //   )
          // )

          // if (!parent) {
          //   return {
          //     ...wishlistRecord.product,
          //     item_id: wishlistRecord.item_id
          //   }
          // }

          // const children = parent.configurable_children.find(children =>
          //   children.sku === wishlistRecord.product.sku
          //   && children.color === +parent.clone_color_id
          // )

          // if (!children) {
          //   return {
          //     ...wishlistRecord.product,
          //     item_id: wishlistRecord.item_id
          //   }
          // }

          // return {
          //   ...mergeProductWithChild(parent, children),
          //   item_id: wishlistRecord.item_id
          // }
        })
      }
    }
  },
  async addItem ({ commit, rootGetters }, product): Promise<Boolean> {

    let item_id: Number
    if (rootGetters['user/isLoggedIn']) {
      let { resultCode, result } = await Wishlist.Add(product.sku, rootGetters['user/getToken'])
      if (resultCode !== 200) {
        rootStore.dispatch('notification/spawnNotification', {
          type: 'error',
          message: i18n.t("Couldn't add this item to the wishlist, sorry."),
          action1: { label: i18n.t('OK') }
        })
        return false
      }
      item_id = result.wishlist_item_id

    }
    commit(types.WISH_ADD_ITEM, {
      product: {
        ...product,
        ...(item_id ? { item_id } : {})
      }
    })
    return true
  },

  async removeItem ({ state, commit, rootGetters }, product): Promise<Boolean> {
    const storageProduct = state.items.find(p => p.sku === product.sku)
    if (rootGetters['user/isLoggedIn'] && storageProduct.item_id) {
      let { resultCode } = await Wishlist.Remove(storageProduct.item_id, rootGetters['user/getToken'])
      if (resultCode !== 200) {
        rootStore.dispatch('notification/spawnNotification', {
          type: 'error',
          message: i18n.t("Couldn't remove this item from the wishlist, sorry."),
          action1: { label: i18n.t('OK') }
        })
        return false
      }
    }
    commit(types.WISH_DEL_ITEM, { product: storageProduct })
  },

  async removeAll ({ state, commit, rootGetters }): Promise<Boolean> {
    const storageProducts = state.items

    if (rootGetters['user/isLoggedIn']) {
      let resultsCodes = await Wishlist.RemoveAll(
        storageProducts.map(product => product.item_id),
        rootGetters['user/getToken']
      )
      if (resultsCodes.some(({ resultCode }) => resultCode !== 200)) {
        rootStore.dispatch('notification/spawnNotification', {
          type: 'error',
          message: i18n.t("Couldn't remove every item from the wishlist, sorry."),
          action1: { label: i18n.t('OK') }
        })
        return false
      }
    }
    commit(types.WISH_DEL_ALL_ITEMS)
  }

}