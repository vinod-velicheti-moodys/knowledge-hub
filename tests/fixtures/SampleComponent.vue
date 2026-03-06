<template>
  <div class="sample-component">
    <slot name="header"></slot>
    <span>{{ title }}</span>
    <slot></slot>
    <button @click="$emit('action-clicked', value)">Click me</button>
  </div>
</template>

<script>
export default {
  name: 'SampleComponent',
  props: {
    title: {
      type: String,
      required: true,
    },
    value: {
      type: Number,
      required: false,
    },
    disabled: {
      type: Boolean,
      required: false,
    },
  },
  emits: ['action-clicked', 'update'],
  methods: {
    handleAction() {
      this.$emit('update', this.value);
    },
  },
};
</script>
